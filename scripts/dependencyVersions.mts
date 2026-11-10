import { readFileSync } from 'node:fs'
import path from 'node:path'

/** Build baseline only: external Python/Ollama processes may run other versions. */
export function dependencyVersions(root: string): Record<string, string> {
  const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
  const versions: Record<string, string> = {}
  for (const [location, spec] of Object.entries(lock.packages) as [string, { version?: string }][]) {
    if (!location.startsWith('node_modules/') || !spec.version) continue
    const name = location.slice('node_modules/'.length)
    if (!name.includes('/node_modules/')) versions[`npm/${name}`] = spec.version
  }
  for (const line of readFileSync(path.join(root, 'sidecar/constraints.txt'), 'utf8').split(/\r?\n/)) {
    const pin = line.match(/^([\w-]+)==([^\s#]+)$/)
    if (pin) versions[`python/${pin[1]}`] = pin[2]
  }
  return versions
}
