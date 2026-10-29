import path from 'node:path'
import fs from 'node:fs'
import depcheck from 'depcheck'
import type { DependencyScanResult } from '../process/dependencyScanProtocol'

const IGNORED = ['node_modules', 'dist', 'build', 'out', 'coverage', '.git', '.onlyrag']

/** Runs only in the scanner worker; parser failures refuse complete evidence. */
export async function scanDependencyFiles(root: string): Promise<DependencyScanResult> {
  const result = await depcheck(root, { ignorePatterns: IGNORED, skipMissing: false })
  const invalidFiles = Object.keys(result.invalidFiles || {}).length
  const invalidDirectories = Object.keys(result.invalidDirs || {}).length
  if (invalidFiles || invalidDirectories) {
    throw new Error(`Dependency scan incomplete: ${invalidFiles} invalid file(s), ${invalidDirectories} inaccessible directory/directories`)
  }
  const missing = result.missing || {}
  const project = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  const peerProviders: Record<string, string> = {}
  for (const provider of Object.keys({ ...project.dependencies, ...project.devDependencies })) {
    const manifestPath = path.join(root, 'node_modules', ...provider.split('/'), 'package.json')
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as { peerDependencies?: Record<string, string> }
      for (const packageName of Object.keys(missing)) {
        if (manifest.peerDependencies?.[packageName]) peerProviders[packageName] = provider
      }
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') continue
      throw err
    }
  }
  return { missing, scanned: true, peerProviders }
}
