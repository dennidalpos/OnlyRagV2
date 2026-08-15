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
 * Validates path safety, directory traversal prevention, and credential blocking.
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

/**
 * Simple .gitignore / .cursorignore line matcher.
 */
export function matchesIgnorePatterns(relPath: string, patterns: string[]): boolean {
  if (!relPath || !patterns || patterns.length === 0) return false
  const normalized = relPath.replace(/\\/g, '/').toLowerCase()

  for (const pattern of patterns) {
    const p = pattern.trim().toLowerCase()
    if (!p || p.startsWith('#')) continue

    const cleanP = p.replace(/^\//, '').replace(/\/$/, '')
    if (normalized === cleanP || normalized.startsWith(cleanP + '/') || normalized.endsWith('/' + cleanP)) {
      return true
    }
  }
  return false
}
