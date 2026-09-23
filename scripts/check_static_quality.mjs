import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import './check_ipc_registration.mjs'
import './check_layering.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const biome = path.join(root, 'node_modules', '@biomejs', 'biome', 'bin', 'biome')

function runBiome(args) {
  const result = spawnSync(process.execPath, [biome, ...args], { cwd: root, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status || 1)
}

runBiome(['lint'])
// Every supported file under biome.json `files.includes` must stay formatted (FORMAT-BASELINE-01).
runBiome(['format'])
console.log('Static formatting: every supported file matches biome.json.')
