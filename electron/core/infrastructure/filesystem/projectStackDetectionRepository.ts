import fs from 'node:fs'
import path from 'node:path'
import { logger } from '../../../diagnostics'

/** Sniffs a workspace's manifest files to build a lowercase tag set of its declared dependencies/tooling. */
export class ProjectStackDetectionRepository {
  detect(workspacePath?: string | null): string[] {
    if (!workspacePath || !fs.existsSync(workspacePath)) return []
    const stack = new Set<string>()

    try {
      // 1. package.json inspection
      const pkgPath = path.join(workspacePath, 'package.json')
      if (fs.existsSync(pkgPath)) {
        try {
          const raw = fs.readFileSync(pkgPath, 'utf-8')
          const pkg = JSON.parse(raw)
          const deps = { ...pkg.dependencies, ...pkg.devDependencies }
          for (const dep of Object.keys(deps)) {
            const clean = dep.replace(/^@[\w-]+\//, '').toLowerCase()
            stack.add(clean)
            stack.add(dep.toLowerCase())
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err)
          logger.log('WARN', 'ProjectStackDetectionRepo', `Failed extracting package.json stack: ${message}`)
        }
      }

      // 2. Python requirements / pyproject
      const reqPath = path.join(workspacePath, 'requirements.txt')
      if (fs.existsSync(reqPath)) {
        stack.add('python')
        const lines = fs.readFileSync(reqPath, 'utf-8').split(/\r?\n/)
        for (const l of lines) {
          const pkg = l.split(/[=<>~]/)[0].trim().toLowerCase()
          if (pkg && !pkg.startsWith('#')) stack.add(pkg)
        }
      }

      const pyproj = path.join(workspacePath, 'pyproject.toml')
      if (fs.existsSync(pyproj)) {
        stack.add('python')
      }

      // 3. Rust Cargo.toml
      if (fs.existsSync(path.join(workspacePath, 'Cargo.toml'))) {
        stack.add('rust')
        stack.add('cargo')
      }

      // 4. Go go.mod
      if (fs.existsSync(path.join(workspacePath, 'go.mod'))) {
        stack.add('go')
        stack.add('golang')
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      logger.log('WARN', 'ProjectStackDetectionRepo', `Failed extracting project stack: ${message}`)
    }

    return Array.from(stack)
  }
}

export const projectStackDetectionRepository = new ProjectStackDetectionRepository()
