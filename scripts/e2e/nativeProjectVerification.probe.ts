import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PersistentPowerShellSession } from '../../electron/core/infrastructure/process/persistentPowerShellSession'
import { agentToolExecutorService } from '../../electron/core/application/agentToolExecutorService'
import { runProjectVerification } from '../../electron/core/application/agentOrchestratorVerificationRunner'
import { discoverProjectProfile } from '../../electron/core/infrastructure/filesystem/projectProfileDiscovery'
import { withVerificationEnvironment } from '../../electron/core/infrastructure/process/powerShellCommand'

vi.mock('../../electron/core/application/agentToolExecutorService', () => ({ agentToolExecutorService: { getOrCreateShellSession: vi.fn() } }))

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-native qualification-'))
const sessions = new Map<string, PersistentPowerShellSession>()
const shellFor = (cwd: string) => {
  let shell = sessions.get(cwd)
  if (!shell) {
    shell = new PersistentPowerShellSession(cwd)
    sessions.set(cwd, shell)
  }
  return shell
}
const write = (relative: string, content: string) => {
  const target = path.join(root, relative)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
}

beforeAll(() => {
  expect(process.platform, 'Native qualification requires Windows PowerShell and all declared tools').toBe('win32')
  vi.mocked(agentToolExecutorService.getOrCreateShellSession).mockImplementation((cwd) => {
    if (!cwd) throw new Error('Native verification requires an explicit fixture workspace')
    return shellFor(cwd)
  })
})
afterAll(async () => {
  for (const shell of sessions.values()) shell.dispose()
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      fs.rmSync(root, { recursive: true, force: true })
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  throw new Error(`Fixture teardown failed: ${root}`)
})

const fixtures = [
  {
    name: 'python',
    manifest: 'pyproject.toml',
    body: '[tool.pytest.ini_options]\ntestpaths = ["tests"]\n',
    file: 'tests/test_math.py',
    good: 'def test_add():\n    assert 2 + 2 == 4\n',
    bad: 'def test_add():\n    assert 2 + 2 == 5\n',
    marker: 'assert',
  },
  {
    name: 'go',
    manifest: 'go.mod',
    body: 'module example.com/onlyragfixture\n\ngo 1.25\n',
    file: 'math_test.go',
    good: 'package fixture\nimport "testing"\nfunc TestAdd(t *testing.T) { if 2+2 != 4 { t.Fatal("native assertion failed") } }\n',
    bad: 'package fixture\nimport "testing"\nfunc TestAdd(t *testing.T) { t.Fatal("native assertion failed") }\n',
    marker: 'native assertion failed',
  },
  {
    name: 'rust',
    manifest: 'Cargo.toml',
    body: '[package]\nname = "onlyrag_fixture"\nversion = "0.1.0"\nedition = "2021"\n',
    file: 'src/lib.rs',
    good: '#[test]\nfn addition() { assert_eq!(2+2, 4); }\n',
    bad: '#[test]\nfn addition() { assert_eq!(2+2, 5); }\n',
    marker: 'assertion',
  },
  {
    name: 'maven',
    manifest: 'pom.xml',
    body: '<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><groupId>example</groupId><artifactId>fixture</artifactId><version>1.0</version><properties><maven.compiler.release>17</maven.compiler.release></properties><dependencies><dependency><groupId>junit</groupId><artifactId>junit</artifactId><version>4.13.2</version><scope>test</scope></dependency></dependencies><build><plugins><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-compiler-plugin</artifactId><version>3.14.0</version></plugin><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-surefire-plugin</artifactId><version>3.5.3</version></plugin></plugins></build></project>',
    file: 'src/test/java/MathTest.java',
    good: 'import org.junit.Test; import static org.junit.Assert.*; public class MathTest { @Test public void addition() { assertEquals(4, 2+2); } }',
    bad: 'import org.junit.Test; import static org.junit.Assert.*; public class MathTest { @Test public void addition() { assertEquals(5, 2+2); } }',
    marker: 'Failures: 1',
  },
  {
    name: 'gradle',
    manifest: 'build.gradle',
    body: "plugins { id 'java' }\ntasks.register('fixtureTest', JavaExec) { classpath = sourceSets.main.runtimeClasspath; mainClass = 'MathTest' }\ncheck.dependsOn fixtureTest\n",
    file: 'src/main/java/MathTest.java',
    good: 'public class MathTest { public static void main(String[] args) { if (2+2 != 4) throw new AssertionError("native assertion failed"); } }',
    bad: 'public class MathTest { public static void main(String[] args) { throw new AssertionError("native assertion failed"); } }',
    marker: 'native assertion failed',
  },
  {
    name: 'composer',
    manifest: 'composer.json',
    body: '{"name":"example/fixture","scripts":{"test":"@php tests/verify.php"}}',
    file: 'tests/verify.php',
    good: '<?php if (2+2 !== 4) { fwrite(STDERR, "native assertion failed"); exit(1); } echo "native test passed";',
    bad: '<?php fwrite(STDERR, "native assertion failed"); exit(1);',
    marker: 'native assertion failed',
  },
]

describe('native project verification through the application runner and real PowerShell', () => {
  it('checks a failing root after an interactive cd and preserves the interactive directory', async () => {
    const fixture = fixtures.find((entry) => entry.name === 'go')!
    write('cwd-root/go.mod', fixture.body)
    write('cwd-root/math_test.go', fixture.bad)
    write('cwd-root/child/go.mod', fixture.body)
    write('cwd-root/child/math_test.go', fixture.good)
    const cwd = path.join(root, 'cwd-root')
    const shell = shellFor(cwd)
    expect((await shell.execute("Set-Location -LiteralPath 'child'")).code).toBe(0)
    const failed = await runProjectVerification(cwd)
    expect(failed.status).toBe('failed')
    expect(failed.failureDetail).toContain('Project: .\n')
    expect(failed.failureDetail).toContain('native assertion failed')
    expect(shell.currentDirectory).toBe(path.join(cwd, 'child'))
    write('cwd-root/math_test.go', fixture.good)
    const passed = await runProjectVerification(cwd)
    expect(passed).toMatchObject({ status: 'verified', evidenceLevel: 'behavioral' })
    expect(passed.verifiedCommands).toHaveLength(2)
    expect(shell.currentDirectory).toBe(path.join(cwd, 'child'))
  })

  for (const [filename, section] of [
    ['setup.cfg', '[tool:pytest]'],
    ['tox.ini', '[pytest]'],
  ]) {
    it(`checks standalone and nested Python assertions configured only by ${filename}`, async () => {
      const relative = `python-${filename}`
      write(`${relative}/${filename}`, `${section}\ntestpaths = tests\n`)
      write(`${relative}/tests/test_math.py`, 'def test_math():\n    assert False, "CONFIG_ONLY_ASSERTION"\n')
      const cwd = path.join(root, relative)
      expect(discoverProjectProfile(cwd).projects[0].toolchain.languages).toContain('python')
      expect((await runProjectVerification(cwd)).status).toBe('failed')
      write(`${relative}/tests/test_math.py`, 'def test_math():\n    assert 2 + 2 == 4\n')
      expect(await runProjectVerification(cwd)).toMatchObject({ status: 'verified', evidenceLevel: 'behavioral' })
      const go = fixtures.find((entry) => entry.name === 'go')!
      write(`${relative}-mixed/go.mod`, go.body)
      write(`${relative}-mixed/math_test.go`, go.good)
      write(`${relative}-mixed/child/${filename}`, `${section}\ntestpaths = tests\n`)
      write(`${relative}-mixed/child/tests/test_math.py`, 'def test_math():\n    assert False, "CONFIG_ONLY_ASSERTION"\n')
      const failed = await runProjectVerification(path.join(root, `${relative}-mixed`))
      expect(failed.status).toBe('failed')
      expect(failed.failureDetail).toContain('Project: child')
      expect(failed.failureDetail).toContain('CONFIG_ONLY_ASSERTION')
    })
  }

  it('separates empty/skipped Go success from executed behavioral tests and enforces an explicit behavioral gate', async () => {
    const fixture = fixtures.find((entry) => entry.name === 'go')!
    write('go-evidence/go.mod', fixture.body)
    write('go-evidence/math.go', 'package fixture\nfunc Value() int { return 42 }\n')
    const cwd = path.join(root, 'go-evidence')
    expect(await runProjectVerification(cwd)).toMatchObject({ status: 'verified', evidenceLevel: 'structural' })
    const command = discoverProjectProfile(cwd).projects[0].verificationCommands[0].command
    const required = await runProjectVerification(cwd, undefined, undefined, false, [
      { id: 'test', title: 'Behavioral test', status: 'pending', verificationCommand: command },
    ])
    expect(required.status).toBe('unverifiable')
    expect(required.verifiedCommands).toBeUndefined()
    write('go-evidence/math_test.go', 'package fixture\nimport "testing"\nfunc TestSkipped(t *testing.T) { t.Skip("deliberately skipped") }\n')
    expect(await runProjectVerification(cwd)).toMatchObject({ status: 'verified', evidenceLevel: 'structural' })
    write('go-evidence/math_test.go', fixture.good)
    expect(await runProjectVerification(cwd)).toMatchObject({ status: 'verified', evidenceLevel: 'behavioral' })
    write('go-evidence/math_test.go', fixture.bad)
    expect((await runProjectVerification(cwd)).status).toBe('failed')
  })

  it('keeps empty and ignored Rust suites structural', async () => {
    const fixture = fixtures.find((entry) => entry.name === 'rust')!
    write('rust-empty/Cargo.toml', fixture.body)
    write('rust-empty/src/lib.rs', 'pub fn value() -> i32 { 42 }\n')
    const cwd = path.join(root, 'rust-empty')
    expect(await runProjectVerification(cwd)).toMatchObject({ status: 'verified', evidenceLevel: 'structural' })
    write('rust-empty/src/lib.rs', '#[test]\n#[ignore]\nfn ignored() { assert!(false); }\n')
    expect(await runProjectVerification(cwd)).toMatchObject({ status: 'verified', evidenceLevel: 'structural' })
  })

  it('does not classify a Gradle check with no sources as behavioral tests', async () => {
    write('gradle-empty/build.gradle', "plugins { id 'java' }\n")
    expect(await runProjectVerification(path.join(root, 'gradle-empty'))).toMatchObject({ status: 'verified', evidenceLevel: 'structural' })
  })

  for (const fixture of fixtures) {
    it(`${fixture.name}: discovers its manifest, passes a native check and reports a genuine assertion failure`, async () => {
      write(`${fixture.name}/${fixture.manifest}`, fixture.body)
      write(`${fixture.name}/${fixture.file}`, fixture.good)
      const cwd = path.join(root, fixture.name)
      const profile = discoverProjectProfile(cwd)
      expect(profile.projects).toHaveLength(1)
      expect(profile.projects[0].verificationCommands.length).toBeGreaterThan(0)
      expect(profile.projects[0].verificationCommands.every((item) => !/npm|npx|node /.test(item.command))).toBe(true)
      if (fixture.name === 'maven' && process.env.ONLYRAG_NATIVE_PREPARE === '1') {
        const warm = await shellFor(cwd).execute('mvn --batch-mode -DfailIfNoTests=true verify', undefined, undefined, 170_000)
        expect(warm.code, warm.stdout + warm.stderr).toBe(0)
      }
      const output: string[] = []
      const passed = await runProjectVerification(cwd, (chunk) => output.push(chunk))
      expect(passed.status, JSON.stringify(passed) + output.join('\n')).toBe('verified')
      expect(passed.verifiedCommands).toEqual(profile.projects[0].verificationCommands.map((item) => item.command))
      expect(passed.evidenceLevel).toBe(['python', 'go', 'rust'].includes(fixture.name) ? 'behavioral' : 'structural')
      if (fixture.name === 'composer') {
        const required = await runProjectVerification(cwd, undefined, undefined, false, [
          { id: 'custom-test', title: 'Custom behavioral check', status: 'pending', verificationCommand: profile.projects[0].verificationCommands[0].command },
        ])
        expect(required.status).toBe('unverifiable')
        expect(required.failureDetail).toContain('executed tests')
      }
      write(`${fixture.name}/${fixture.file}`, fixture.bad)
      const failed = await runProjectVerification(cwd)
      expect(failed.status, JSON.stringify(failed)).toBe('failed')
      expect(failed.failureDetail).toContain(fixture.name)
      expect(failed.failureDetail).toContain(fixture.marker)
    })
  }

  it('does not replace an absent native tool with Node or report a stale zero exit code', async () => {
    write('absent/go.mod', 'module example.com/absent\n\ngo 1.25\n')
    const cwd = path.join(root, 'absent')
    await shellFor(cwd).execute("$env:PATH = ''; $global:LASTEXITCODE = 0")
    const result = await runProjectVerification(cwd)
    expect(result.status).toBe('unverifiable')
    expect(result.failureDetail).toContain('VERIFICATION_TOOL_UNAVAILABLE:go')
    expect(result.verifiedCommands).toBeUndefined()
  })

  it('terminates a timed out native process and reuses a fresh owned shell', async () => {
    write('timeout/pyproject.toml', '[tool.pytest.ini_options]\n')
    write('timeout/sleep.py', 'import time\ntime.sleep(60)\n')
    const shell = shellFor(path.join(root, 'timeout'))
    const before = Date.now()
    const result = await shell.execute('python -B sleep.py', undefined, undefined, 1500)
    expect(result).toMatchObject({ code: 124, timedOut: true })
    expect(Date.now() - before).toBeLessThan(10_000)
    expect((await shell.execute('python -c "print(42)"')).code).toBe(0)
  })

  it('restores native offline settings after failure and honours cancellation', async () => {
    write('environment/go.mod', 'module example.com/environment\n\ngo 1.25\n')
    const cwd = path.join(root, 'environment')
    const shell = shellFor(cwd)
    await shell.execute("$env:GOPROXY = 'fixture-original'")
    const result = await shell.execute(withVerificationEnvironment('go test ./missing'))
    expect(result.code).not.toBe(0)
    expect((await shell.execute('Write-Output $env:GOPROXY')).stdout).toContain('fixture-original')
    const controller = new AbortController()
    controller.abort()
    expect((await runProjectVerification(cwd, undefined, controller.signal)).status).toBe('unverifiable')
  })

  it('cancels an executing native test without certifying it or blocking the next command', async () => {
    write('cancel/pytest.ini', '[pytest]\n')
    write('cancel/test_wait.py', 'import time\ndef test_wait():\n    time.sleep(60)\n')
    const cwd = path.join(root, 'cancel')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 1500)
    const before = Date.now()
    try {
      const result = await runProjectVerification(cwd, undefined, controller.signal)
      expect(result.status).toBe('unverifiable')
      expect(result.verifiedCommands).toBeUndefined()
      expect(Date.now() - before).toBeLessThan(10_000)
      expect((await shellFor(cwd).execute('python -c "print(42)"')).code).toBe(0)
    } finally {
      clearTimeout(timer)
    }
  })
})
