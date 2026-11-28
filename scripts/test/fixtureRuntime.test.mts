import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'
import { assertOwnedFixture, createFixtureDirectory, retainFixture } from './fixtureRuntime.mjs'

it('allocates empty, unique fixture trees and retains exact bytes across repeated completion', () => {
  const first = createFixtureDirectory('ownership-')
  const second = createFixtureDirectory('ownership-')
  expect(first).not.toBe(second)
  expect(fs.readdirSync(first)).toEqual([])
  const bytes = Buffer.from([0, 255, 13, 10, 42])
  fs.writeFileSync(path.join(first, 'evidence.bin'), bytes)
  retainFixture(first)
  retainFixture(first)
  expect(fs.readFileSync(path.join(first, 'evidence.bin'))).toEqual(bytes)
  expect(assertOwnedFixture(first).manifest).toMatchObject({ status: 'retained', retention: 'until-explicit-cleanup' })
  expect(fs.existsSync(second)).toBe(true)
  retainFixture(second)
})

it('refuses foreign paths and altered ownership without changing evidence', () => {
  const fixture = createFixtureDirectory('ownership-refusal-')
  const owned = assertOwnedFixture(fixture)
  const original = fs.readFileSync(owned.manifestPath)
  expect(() => retainFixture(path.dirname(fixture))).toThrow('Not an owned fixture')
  expect(() => retainFixture(process.cwd())).toThrow('Not an owned fixture')
  fs.writeFileSync(owned.manifestPath, JSON.stringify({ ...owned.manifest, directory: process.cwd() }))
  expect(() => retainFixture(fixture)).toThrow('Invalid fixture ownership')
  expect(fs.existsSync(fixture)).toBe(true)
  fs.writeFileSync(owned.manifestPath, original)
  retainFixture(fixture)
})

it('uses the same retained storage contract in a real subprocess', () => {
  const cli = path.resolve('scripts/test/fixtureCli.mjs')
  const fixture = execFileSync(process.execPath, [cli, 'create', 'subprocess-'], { encoding: 'utf8', windowsHide: true }).trim()
  fs.writeFileSync(path.join(fixture, 'receipt.txt'), 'subprocess evidence')
  execFileSync(process.execPath, [cli, 'retain', fixture], { windowsHide: true })
  expect(assertOwnedFixture(fixture).manifest.status).toBe('retained')
  expect(fs.readFileSync(path.join(fixture, 'receipt.txt'), 'utf8')).toBe('subprocess evidence')
})

it('keeps synthetic Git commands from discovering the product repository', () => {
  const fixture = createFixtureDirectory('git-boundary-')
  const before = spawnSync('git', ['-C', fixture, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', windowsHide: true })
  expect(before.status).not.toBe(0)
  execFileSync('git', ['-C', fixture, 'init', '--quiet'], { windowsHide: true })
  const after = execFileSync('git', ['-C', fixture, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', windowsHide: true }).trim()
  expect(path.resolve(after)).toBe(fixture)
  retainFixture(fixture)
})
