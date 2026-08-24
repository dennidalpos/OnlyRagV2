import fs from 'node:fs'
import path from 'node:path'

export interface FileInfoResult {
  isDirectory: boolean
  sizeBytes: number
  isBinary: boolean
  lineCount: number
  mtimeIso: string
}

/** Raw filesystem primitives for the agent tool executor's file-mutating and inspection tools. */
export class AgentToolFileRepository {
  /** Current on-disk content, or '' when the file does not exist yet (a pure addition). */
  readIfExists(absolutePath: string): string {
    try {
      return fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, 'utf-8') : ''
    } catch {
      return ''
    }
  }

  listDirEntries(absolutePath: string): { name: string; isDir: boolean }[] | null {
    if (!fs.existsSync(absolutePath)) return null
    return fs.readdirSync(absolutePath, { withFileTypes: true }).map((e) => ({ name: e.name, isDir: e.isDirectory() }))
  }

  mkdir(absolutePath: string): void {
    fs.mkdirSync(absolutePath, { recursive: true })
  }

  copyFileRaw(srcPath: string, dstPath: string): void {
    fs.copyFileSync(srcPath, dstPath)
  }

  renameRaw(srcPath: string, dstPath: string): void {
    fs.renameSync(srcPath, dstPath)
  }

  /** Depth-bounded directory tree scan, formatted as `[DIR]`/`[FILE]` lines relative to rootPath. Assumes rootPath exists. */
  listRecursive(rootPath: string, maxDepth: number, ignoreDirs: Set<string>): string[] {
    const discovered: string[] = []
    const walk = (currentDir: string, depth: number) => {
      if (depth > maxDepth) return
      const entries = fs.readdirSync(currentDir, { withFileTypes: true })
      for (const entry of entries) {
        if (ignoreDirs.has(entry.name)) continue
        const fullPath = path.join(currentDir, entry.name)
        const relPath = path.relative(rootPath, fullPath).replace(/\\/g, '/')
        if (entry.isDirectory()) {
          discovered.push(`[DIR]  ${relPath}/`)
          walk(fullPath, depth + 1)
        } else if (entry.isFile()) {
          discovered.push(`[FILE] ${relPath}`)
        }
      }
    }
    walk(rootPath, 1)
    return discovered
  }

  /** Stat + binary sniff (first 1KB, null-byte heuristic) + line count for a text file. Null if the path does not exist. */
  getFileInfo(absolutePath: string): FileInfoResult | null {
    if (!fs.existsSync(absolutePath)) return null
    const stats = fs.statSync(absolutePath)
    let lineCount = 0
    let isBinary = false

    if (stats.isFile()) {
      const buf = Buffer.alloc(1024)
      const fd = fs.openSync(absolutePath, 'r')
      const bytesRead = fs.readSync(fd, buf, 0, 1024, 0)
      fs.closeSync(fd)

      for (let i = 0; i < bytesRead; i++) {
        if (buf[i] === 0) {
          isBinary = true
          break
        }
      }

      if (!isBinary) {
        const fullContent = fs.readFileSync(absolutePath, 'utf-8')
        lineCount = fullContent.split('\n').length
      }
    }

    return {
      isDirectory: stats.isDirectory(),
      sizeBytes: stats.size,
      isBinary,
      lineCount,
      mtimeIso: stats.mtime.toISOString(),
    }
  }

  /** package.json `scripts` map, or null if missing/unparsable. */
  readPackageJsonScripts(cwd: string): Record<string, string> | null {
    const pkgJsonPath = path.join(cwd, 'package.json')
    if (!fs.existsSync(pkgJsonPath)) return null
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'))
      return pkg.scripts || {}
    } catch {
      return null
    }
  }

  hasPytestConfig(cwd: string): boolean {
    return ['pytest.ini', 'pyproject.toml', 'setup.cfg'].some((f) => fs.existsSync(path.join(cwd, f)))
  }

  /**
   * What the workspace declares it can import: every dependency name in package.json, plus the
   * bare prefixes that resolve through tsconfig `compilerOptions.paths` (`@/*` -> `@/`).
   *
   * Returns null when there is no readable package.json — a workspace too early to judge an
   * import against, which the caller must treat as "no opinion" rather than "nothing declared".
   */
  readDeclaredPackages(cwd: string): { names: Set<string>; aliasPrefixes: string[] } | null {
    const pkgJsonPath = path.join(cwd, 'package.json')
    if (!fs.existsSync(pkgJsonPath)) return null

    let pkg: Record<string, Record<string, string> | undefined>
    try {
      pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'))
    } catch {
      return null
    }

    const names = new Set<string>()
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const name of Object.keys(pkg[field] || {})) names.add(name)
    }

    const aliasPrefixes: string[] = []
    const tsconfigPath = path.join(cwd, 'tsconfig.json')
    if (fs.existsSync(tsconfigPath)) {
      try {
        // Comments are legal in tsconfig and would break JSON.parse; a tsconfig this cannot
        // read simply contributes no aliases.
        const raw = fs
          .readFileSync(tsconfigPath, 'utf-8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|\s)\/\/.*$/gm, '$1')
        const paths = JSON.parse(raw)?.compilerOptions?.paths || {}
        for (const pattern of Object.keys(paths)) {
          const prefix = pattern.split('*')[0]
          if (prefix) aliasPrefixes.push(prefix)
        }
      } catch {}
    }

    return { names, aliasPrefixes }
  }

  /**
   * Of the given package names, those with no directory under `<cwd>/node_modules`.
   *
   * A name in package.json is a declaration, not an installation, and the two diverge in the
   * exact situation an agent creates: it authors package.json with write_file, so every
   * dependency is "declared" while node_modules has never existed. In
   * session-1787562597025-q8a5 the redundant-install guard read that declaration, told the
   * model the packages were "already installed", and cancelled the one `npm install` of the
   * session — after which every `npm run build` failed for the rest of the run.
   *
   * A scoped name maps to nested directories (`@scope/pkg` -> `node_modules/@scope/pkg`).
   */
  missingFromNodeModules(cwd: string, packageNames: string[]): string[] {
    const modulesRoot = path.join(cwd, 'node_modules')
    if (!fs.existsSync(modulesRoot)) return [...packageNames]
    return packageNames.filter((name) => !fs.existsSync(path.join(modulesRoot, ...name.split('/'))))
  }
}

export const agentToolFileRepository = new AgentToolFileRepository()
