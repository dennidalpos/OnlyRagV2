import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const IGNORE_ALL = '# Written by OnlyRag: local agent state, never committed.\n*\n'
const LAYOUT_VERSION = 2

function sessionKey(sessionId: string): string {
  if (!sessionId.trim()) throw new Error('Session id is required')
  return createHash('sha256').update(sessionId).digest('hex')
}

function assertDirectoryWithoutLink(directory: string): void {
  if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true })
  const stat = fs.lstatSync(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Unsafe OnlyRag metadata directory: ${directory}`)
}

function assertFileWithoutLink(file: string): void {
  const stat = fs.lstatSync(file, { throwIfNoEntry: false })
  if (!stat) return
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Unsafe OnlyRag metadata file: ${file}`)
}

function metadataDirectory(root: string, ...parts: string[]): string {
  let current = root
  for (const part of parts) {
    current = path.join(current, part)
    if (fs.existsSync(current)) assertDirectoryWithoutLink(current)
  }
  return current
}

function metadataPath(root: string, ...parts: string[]): string {
  return path.join(metadataDirectory(root, ...parts.slice(0, -1)), parts[parts.length - 1])
}

function copyVerified(root: string, source: string, target: string): void {
  assertFileWithoutLink(source)
  const relative = path.relative(root, target)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Metadata target escapes workspace: ${target}`)
  metadataPath(root, ...relative.split(path.sep))
  fs.mkdirSync(path.dirname(target), { recursive: true })
  assertFileWithoutLink(target)
  if (!fs.existsSync(target)) {
    const temporary = `${target}.tmp-${process.pid}`
    fs.copyFileSync(source, temporary)
    fs.renameSync(temporary, target)
  }
  if (!fs.readFileSync(source).equals(fs.readFileSync(target))) throw new Error(`OnlyRag metadata migration conflict: ${target}`)
}

function legacySources(root: string): string[] {
  const sessionsDir = path.join(root, 'sessions')
  if (fs.existsSync(sessionsDir)) assertDirectoryWithoutLink(sessionsDir)
  const assistantDir = path.join(root, 'assistant')
  if (fs.existsSync(assistantDir)) assertDirectoryWithoutLink(assistantDir)
  const history = path.join(sessionsDir, 'session_history.json')
  const legacyTracker = path.join(assistantDir, 'SESSION_TRACKER.md')
  const states = fs.existsSync(sessionsDir)
    ? fs
        .readdirSync(sessionsDir)
        .filter((name) => /^\.agent_state_.*\.json$/.test(name))
        .map((name) => path.join(sessionsDir, name))
    : []
  return [history, ...states, legacyTracker].filter((file) => fs.existsSync(file))
}

function migrateLegacyLayout(root: string): void {
  const sessionsDir = path.join(root, 'sessions')
  const history = path.join(sessionsDir, 'session_history.json')
  const legacyTracker = path.join(root, 'assistant', 'SESSION_TRACKER.md')
  const sources = legacySources(root)
  if (sources.length === 0) return

  const backupRoot = path.join(root, 'migration-backup', 'v1')
  for (const source of sources) copyVerified(root, source, path.join(backupRoot, path.relative(root, source)))

  const sessionIds = new Set<string>()
  if (fs.existsSync(history)) {
    const parsed = JSON.parse(fs.readFileSync(history, 'utf-8')) as { sessions?: Array<{ id?: unknown }> }
    if (!Array.isArray(parsed.sessions)) throw new Error('Invalid legacy session history')
    for (const session of parsed.sessions) if (typeof session.id === 'string' && session.id.trim()) sessionIds.add(session.id)
    copyVerified(root, history, path.join(sessionsDir, 'history.json'))
    JSON.parse(fs.readFileSync(path.join(sessionsDir, 'history.json'), 'utf-8'))
  }
  for (const source of sources.filter((file) => path.basename(file).startsWith('.agent_state_'))) {
    const parsed = JSON.parse(fs.readFileSync(source, 'utf-8')) as { sessionId?: unknown }
    if (typeof parsed.sessionId !== 'string' || !parsed.sessionId.trim()) throw new Error(`Invalid legacy session state: ${source}`)
    sessionIds.add(parsed.sessionId)
    copyVerified(root, source, path.join(sessionsDir, sessionKey(parsed.sessionId), 'state.json'))
    JSON.parse(fs.readFileSync(path.join(sessionsDir, sessionKey(parsed.sessionId), 'state.json'), 'utf-8'))
  }
  if (fs.existsSync(legacyTracker)) {
    const target =
      sessionIds.size === 1
        ? path.join(sessionsDir, sessionKey([...sessionIds][0]), 'SESSION_TRACKER.md')
        : path.join(root, 'legacy-unassigned', 'SESSION_TRACKER.md')
    copyVerified(root, legacyTracker, target)
  }
}

function removeMigratedSources(root: string): void {
  for (const source of legacySources(root)) {
    const backup = path.join(root, 'migration-backup', 'v1', path.relative(root, source))
    if (!fs.existsSync(backup) || !fs.readFileSync(source).equals(fs.readFileSync(backup))) {
      throw new Error(`OnlyRag metadata backup is missing or changed: ${source}`)
    }
    fs.unlinkSync(source)
  }
  const oldAssistant = path.join(root, 'assistant')
  if (fs.existsSync(oldAssistant) && fs.readdirSync(oldAssistant).length === 0) fs.rmdirSync(oldAssistant)
}

/** Creates and migrates the local metadata store for any Agent Coding workspace. */
export function ensureWorkspaceMetadataDirectory(workspacePath: string): string {
  const workspace = path.resolve(workspacePath)
  if (!fs.statSync(workspace).isDirectory()) throw new Error(`Workspace is not a directory: ${workspace}`)
  const root = path.join(workspace, '.onlyrag')
  assertDirectoryWithoutLink(root)
  const ignoreFile = path.join(root, '.gitignore')
  assertFileWithoutLink(ignoreFile)
  if (!fs.existsSync(ignoreFile)) fs.writeFileSync(ignoreFile, IGNORE_ALL, 'utf-8')

  const layoutFile = path.join(root, 'layout.json')
  assertFileWithoutLink(layoutFile)
  if (fs.existsSync(layoutFile)) {
    const layout = JSON.parse(fs.readFileSync(layoutFile, 'utf-8')) as { version?: number }
    if (layout.version !== LAYOUT_VERSION) throw new Error(`Unsupported OnlyRag metadata layout: ${layout.version}`)
    removeMigratedSources(root)
    return root
  }

  migrateLegacyLayout(root)
  const temporaryLayout = `${layoutFile}.tmp-${process.pid}`
  fs.writeFileSync(temporaryLayout, `${JSON.stringify({ version: LAYOUT_VERSION })}\n`, 'utf-8')
  fs.renameSync(temporaryLayout, layoutFile)
  removeMigratedSources(root)
  return root
}

export function workspaceMetadataHistoryPath(workspacePath: string): string {
  const root = ensureWorkspaceMetadataDirectory(workspacePath)
  return metadataPath(root, 'sessions', 'history.json')
}

export function workspaceMetadataSessionDirectory(workspacePath: string, sessionId: string): string {
  const root = ensureWorkspaceMetadataDirectory(workspacePath)
  return metadataDirectory(root, 'sessions', sessionKey(sessionId))
}

export function workspaceMetadataStatePath(workspacePath: string, sessionId: string): string {
  return path.join(workspaceMetadataSessionDirectory(workspacePath, sessionId), 'state.json')
}

export function workspaceMetadataTrackerPath(workspacePath: string, sessionId: string): string {
  return path.join(workspaceMetadataSessionDirectory(workspacePath, sessionId), 'SESSION_TRACKER.md')
}

export function workspaceMetadataChildPath(workspacePath: string, child: 'checkpoints' | 'artifacts' | 'visual-validation'): string {
  const root = ensureWorkspaceMetadataDirectory(workspacePath)
  return metadataDirectory(root, child)
}
