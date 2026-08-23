import path from 'node:path'

export const DEFAULT_IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'dist-electron',
  '.venv',
  'build',
  'sidecar_dist',
  '.gemini',
  '__pycache__',
  'coverage',
  '.pytest_cache',
  '.DS_Store',
  'tmp',
  'temp',
  'logs',
  '.idea',
  '.vscode',
  '.aws',
  '.ssh',
])

export const DEFAULT_IGNORED_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.webp',
  '.ico',
  '.pdf',
  '.wasm',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.zip',
  '.tar',
  '.gz',
  '.7z',
  '.rar',
  '.pyc',
  '.pyo',
  '.pyd',
  '.sqlite',
  '.db',
  '.bin',
  '.dat',
  '.ttf',
  '.woff',
  '.woff2',
  '.eot',
  '.mp3',
  '.mp4',
  '.wav',
  '.avi',
  // Secret/Key extensions
  '.pem',
  '.key',
  '.pkcs12',
  '.p12',
  '.pfx',
  '.asc',
  '.kdbx',
  '.ppk',
  '.keystore',
])

export const SECRET_FILENAMES = new Set([
  '.env',
  '.env.local',
  '.env.production',
  '.env.development',
  '.env.staging',
  '.env.test',
  'id_rsa',
  'id_rsa.pub',
  'id_ed25519',
  'id_ed25519.pub',
  'id_dsa',
  'known_hosts',
  'authorized_keys',
  'credentials',
  'credentials.json',
  'service-account.json',
  'client_secret.json',
  'secrets.json',
  'shadow',
  'passwd',
])

export const DEFAULT_IGNORED_FILENAMES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'cargo.lock',
  'poetry.lock',
  '.ds_store',
  'thumbs.db',
  ...Array.from(SECRET_FILENAMES),
])

/**
 * Checks if a filename or path targets a credential/secret file.
 */
export function isSecretFile(filePath: string): boolean {
  if (!filePath) return false
  const baseName = path.basename(filePath).toLowerCase().trim()
  if (SECRET_FILENAMES.has(baseName)) return true
  if (baseName.startsWith('.env')) return true

  const ext = path.extname(baseName)
  if (ext && (ext === '.pem' || ext === '.key' || ext === '.p12' || ext === '.pfx' || ext === '.asc' || ext === '.ppk')) {
    return true
  }

  return false
}

/**
 * Evaluates whether a file or directory name should be excluded from AI context window and file scanning.
 */
export function isIgnoredPath(name: string, isDirectory: boolean = false): boolean {
  if (!name) return true
  const lowerName = name.toLowerCase().trim()

  if (isDirectory) {
    return DEFAULT_IGNORED_DIRS.has(lowerName) || lowerName.startsWith('.')
  }

  if (DEFAULT_IGNORED_DIRS.has(lowerName)) return true
  if (DEFAULT_IGNORED_FILENAMES.has(lowerName)) return true
  if (isSecretFile(lowerName)) return true

  const ext = path.extname(lowerName)
  if (ext && DEFAULT_IGNORED_EXTENSIONS.has(ext)) return true

  return false
}

/**
 * Strips shell command chaining characters (;, &&, ||, \n) and CLI prefixes from path strings.
 * Prevents command pollution from creating directories named after shell commands.
 */
export function stripShellCommandChaining(rawPath: string): string {
  if (!rawPath || typeof rawPath !== 'string') return rawPath
  let pathOnly = rawPath.trim()

  if (/;|\&\&|\|\||\n/.test(pathOnly)) {
    pathOnly = pathOnly.split(/;|\&\&|\|\||\n/)[0].trim()
  }

  const cliIndex = pathOnly.search(/\b(?:cd|npx|npm|pip|node|git|yarn|pnpm)\s+/i)
  if (cliIndex > 0) {
    pathOnly = pathOnly.substring(0, cliIndex).trim()
  } else if (cliIndex === 0) {
    const match = pathOnly.match(/^cd\s+["']?([^"';&\n]+)["']?/i)
    if (match && match[1]) {
      pathOnly = match[1].trim()
    }
  }

  return pathOnly.trim()
}

/**
 * Sanitizes file path segments by converting space-containing file and directory names into clean kebab-case.
 * e.g. "src/my component/App Header.tsx" -> "src/my-component/App-Header.tsx"
 */
export function sanitizeFilePathSpaces(filePath: string): string {
  if (!filePath || typeof filePath !== 'string') return filePath
  const stripped = stripShellCommandChaining(filePath)
  const normalized = stripped.replace(/\\/g, '/')
  const isAbsolute = path.isAbsolute(normalized) || /^[a-zA-Z]:\//.test(normalized)

  const parts = normalized.split('/')
  const sanitizedParts = parts.map((part, index) => {
    // Preserve Windows drive letters like "D:" or root slashes
    if (index === 0 && /^[a-zA-Z]:$/.test(part)) return part
    if (!part.trim()) return part

    // Replace multiple spaces with a single dash in file and directory names
    return part.trim().replace(/\s+/g, '-')
  })

  const clean = sanitizedParts.join('/')
  return isAbsolute ? path.normalize(clean) : clean
}

/**
 * Checks if a target path is inside a protected Windows system directory (e.g. Program Files, SystemRoot).
 */
export function isProtectedSystemDirectory(targetPath?: string | null): boolean {
  if (!targetPath || typeof targetPath !== 'string') return false
  try {
    const normalized = path.resolve(targetPath.trim()).toLowerCase()
    const programFiles = (process.env.ProgramFiles || 'C:\\Program Files').toLowerCase()
    const programFilesX86 = (process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)').toLowerCase()
    const sysRoot = (process.env.SystemRoot || 'C:\\Windows').toLowerCase()

    if (normalized.startsWith(programFiles) || normalized.startsWith(programFilesX86) || normalized.startsWith(sysRoot)) {
      return true
    }
  } catch {}
  return false
}

/**
 * Validates path safety, directory traversal prevention, credential blocking, and file name space sanitization.
 */
export function validatePathSafety(filePath?: string | null, workspaceRoot?: string | null): { safePath: string | null; error?: string } {
  if (!filePath || typeof filePath !== 'string' || !filePath.trim()) {
    return { safePath: null, error: 'Empty or invalid file path' }
  }

  try {
    let cleanPath = filePath.trim().replace(/^["']+|["']+$/g, '')
    if (!cleanPath) {
      return { safePath: null, error: 'Empty or invalid file path' }
    }

    // Automatically sanitize spaces in file/directory path segments
    cleanPath = sanitizeFilePathSpaces(cleanPath)

    const resolvedRoot = workspaceRoot && workspaceRoot.trim() ? path.resolve(workspaceRoot.trim()) : null

    // If path is relative and workspaceRoot is provided, resolve against workspaceRoot
    let resolvedPath: string
    if (path.isAbsolute(cleanPath)) {
      resolvedPath = path.resolve(cleanPath)
    } else if (resolvedRoot) {
      resolvedPath = path.resolve(resolvedRoot, cleanPath)
    } else {
      resolvedPath = path.resolve(cleanPath)
    }

    if (isSecretFile(resolvedPath)) {
      return { safePath: null, error: `Access forbidden: '${path.basename(resolvedPath)}' contains sensitive credentials/secrets.` }
    }

    if (isProtectedSystemDirectory(resolvedPath)) {
      return { safePath: null, error: `Access forbidden: Path '${resolvedPath}' is inside a protected system directory (Program Files / Windows). Please select a user workspace directory.` }
    }

    if (resolvedRoot) {
      const relative = path.relative(resolvedRoot, resolvedPath)
      const isOutside = relative.startsWith('..') || path.isAbsolute(relative)
      if (isOutside && resolvedPath !== resolvedRoot) {
        return { safePath: null, error: `Directory Traversal Blocked: Path '${filePath}' is outside workspace root '${workspaceRoot}'.` }
      }
    }

    return { safePath: resolvedPath }
  } catch (err: any) {
    return { safePath: null, error: `Path resolution failed: ${err.message}` }
  }
}
