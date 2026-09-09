import { execFileSync, spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const git = process.platform === 'win32' ? 'git.exe' : 'git'
const biome = path.join(root, 'node_modules', '@biomejs', 'biome', 'bin', 'biome')
const base = process.argv.find((argument) => argument.startsWith('--base='))?.slice('--base='.length) || process.env.STATIC_QUALITY_BASE

function lines(command, args) {
  try {
    return execFileSync(command, args, {
      cwd: root,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split(/\r?\n/)
      .filter(Boolean)
  } catch {
    return []
  }
}

function runBiome(args) {
  const result = spawnSync(process.execPath, [biome, ...args], { cwd: root, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status || 1)
}

function validBase(reference) {
  if (!reference || /^0+$/.test(reference)) return false
  return spawnSync(git, ['rev-parse', '--verify', `${reference}^{commit}`], { cwd: root, stdio: 'ignore' }).status === 0
}

runBiome(['lint'])

const effectiveBase = validBase(base) ? base : process.env.CI && validBase('HEAD^') ? 'HEAD^' : undefined
const added = effectiveBase
  ? lines(git, ['diff', '--name-only', '--diff-filter=A', `${effectiveBase}...HEAD`, '--'])
  : [...lines(git, ['diff', '--name-only', '--diff-filter=A', 'HEAD', '--']), ...lines(git, ['ls-files', '--others', '--exclude-standard'])]
const supported = /\.(cjs|css|cts|js|json|jsonc|jsx|mjs|mts|ts|tsx)$/i
const candidates = [...new Set(added.filter((filePath) => supported.test(filePath)))]

if (candidates.length === 0) {
  console.log('Static formatting: no newly added supported files.')
} else {
  runBiome(['format', ...candidates])
}
