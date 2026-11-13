import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { assertOwnedFixture, createFixtureDirectory, retainFixture } from '../../../../scripts/test/fixtureRuntime.mjs'
import { ArtifactRepository, ArtifactStoreError } from './artifactRepository'
import { CustomHubRepository, CustomHubStoreError } from './customHubRepository'
import { userDataRoot } from './userDataRoot'

// The standard Node setup binds userDataRoot to an owned synthetic profile.
// Run explicitly on Windows with ONLYRAG_TEST_STORE_ACL=1.
describe.runIf(process.platform === 'win32' && process.env.ONLYRAG_TEST_STORE_ACL === '1')('native Windows store access failures', () => {
  let artifactRoot: string
  const hubRoot = userDataRoot()
  const denyCode = /^(EACCES|EPERM)$/

  beforeAll(() => {
    artifactRoot = createFixtureDirectory('onlyrag-artifact-acl-')
  })
  afterAll(() => {
    if (artifactRoot) retainFixture(artifactRoot)
  })

  async function deny<T>(target: string, right: 'ReadData' | 'WriteData', run: () => Promise<T>): Promise<T> {
    const fixture = target === hubRoot || target === path.join(hubRoot, 'custom_hubs.json') ? hubRoot : artifactRoot
    assertOwnedFixture(fixture)
    const realTarget = fs.realpathSync.native(target)
    const relative = path.relative(fixture, realTarget)
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || fs.lstatSync(target).isSymbolicLink()) {
      throw new Error('ACL target is outside the owned test fixture')
    }
    const acl = (script: string, original = '') =>
      execFileSync('pwsh.exe', ['-NoProfile', '-NonInteractive', '-Command', '$ErrorActionPreference = "Stop"; ' + script], {
        encoding: 'utf8',
        windowsHide: true,
        env: { ...process.env, ONLYRAG_ACL_TARGET: target, ONLYRAG_ACL_RIGHT: right, ONLYRAG_ACL_ORIGINAL: original },
        timeout: 10000,
      }).trim()
    const original = acl('(Get-Acl -LiteralPath $env:ONLYRAG_ACL_TARGET).Sddl')
    try {
      acl(`
        $acl = Get-Acl -LiteralPath $env:ONLYRAG_ACL_TARGET
        $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
        $right = [System.Security.AccessControl.FileSystemRights]$env:ONLYRAG_ACL_RIGHT
        $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, $right, 'Deny')
        $acl.AddAccessRule($rule)
        Set-Acl -LiteralPath $env:ONLYRAG_ACL_TARGET -AclObject $acl
      `)
      return await run()
    } finally {
      const restored = acl(
        `
        $acl = Get-Acl -LiteralPath $env:ONLYRAG_ACL_TARGET
        $acl.SetSecurityDescriptorSddlForm($env:ONLYRAG_ACL_ORIGINAL, 'Access')
        Set-Acl -LiteralPath $env:ONLYRAG_ACL_TARGET -AclObject $acl
        (Get-Acl -LiteralPath $env:ONLYRAG_ACL_TARGET).Sddl
      `,
        original,
      )
      expect(restored).toBe(original)
    }
  }

  async function deniedRead(file: string, run: () => Promise<void>) {
    const previous = fs.readFileSync(file)
    await deny(file, 'ReadData', async () => {
      await expect(fs.promises.readFile(file)).rejects.toMatchObject({ code: expect.stringMatching(denyCode) })
      await run()
    })
    expect(fs.readFileSync(file)).toEqual(previous)
  }

  async function deniedWrite(file: string, run: () => Promise<void>) {
    const directory = path.dirname(file)
    const previous = fs.readFileSync(file)
    const entries = fs.readdirSync(directory)
    await deny(directory, 'WriteData', async () => {
      await run()
      expect(fs.readFileSync(file)).toEqual(previous)
      expect(fs.readdirSync(directory)).toEqual(entries)
    })
    expect(fs.readFileSync(file)).toEqual(previous)
    expect(fs.readdirSync(directory)).toEqual(entries)
  }

  it('preserves an unreadable artifact and the record after a denied atomic write, then recovers', async () => {
    const repo = new ArtifactRepository()
    const saved = await repo.save(artifactRoot, { name: 'Original', kind: 'markdown', content: '# Previous' })
    const file = path.join(artifactRoot, '.onlyrag', 'artifacts', `${saved.id}.json`)
    const update = { id: saved.id, name: saved.name, kind: saved.kind, content: '# Updated' }
    await deniedRead(file, async () => {
      for (const operation of [() => repo.get(artifactRoot, saved.id), () => repo.list(artifactRoot), () => repo.save(artifactRoot, update)]) {
        const failure = await operation().catch((error: unknown) => error)
        expect(failure).toBeInstanceOf(ArtifactStoreError)
        expect(failure).toHaveProperty('message', expect.stringMatching(/unreadable.*(?:EACCES|EPERM)/i))
      }
    })
    expect(await new ArtifactRepository().list(artifactRoot)).toEqual([saved])
    await deniedWrite(file, async () => {
      await expect(repo.save(artifactRoot, update)).rejects.toMatchObject({ code: expect.stringMatching(denyCode) })
      expect(await new ArtifactRepository().get(artifactRoot, saved.id)).toEqual(saved)
    })
    const retried = await repo.save(artifactRoot, update)
    expect(retried).toMatchObject({ id: saved.id, createdAt: saved.createdAt, content: update.content })
    expect(await new ArtifactRepository().list(artifactRoot)).toEqual([retried])
  }, 25000)

  it('preserves an unreadable hub list and the list after a denied atomic write, then recovers', async () => {
    const repo = new CustomHubRepository()
    const saved = await repo.addSource({ name: 'Original', url: 'builtin://synthetic' })
    const original = await repo.listSources()
    const file = path.join(userDataRoot(), 'custom_hubs.json')
    const addition = { name: 'Second', url: 'builtin://synthetic-second' }
    await deniedRead(file, async () => {
      for (const operation of [() => repo.listSources(), () => repo.addSource(addition), () => repo.removeSource(saved.id)]) {
        const failure = await operation().catch((error: unknown) => error)
        expect(failure).toBeInstanceOf(CustomHubStoreError)
        expect(failure).toHaveProperty('message', expect.stringMatching(/unreadable.*(?:EACCES|EPERM)/i))
      }
    })
    expect(await new CustomHubRepository().listSources()).toEqual(original)
    await deniedWrite(file, async () => {
      await expect(repo.addSource(addition)).rejects.toMatchObject({ code: expect.stringMatching(denyCode) })
      await expect(repo.removeSource(saved.id)).rejects.toMatchObject({ code: expect.stringMatching(denyCode) })
      expect(await new CustomHubRepository().listSources()).toEqual(original)
    })
    const added = await repo.addSource(addition)
    expect(await new CustomHubRepository().listSources()).toEqual([...original, added])
    expect(await repo.removeSource(saved.id)).toBe(true)
    expect(await new CustomHubRepository().listSources()).toEqual(original.filter((entry) => entry.id !== saved.id).concat(added))
  }, 25000)
})
