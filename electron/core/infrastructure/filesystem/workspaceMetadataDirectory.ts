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

function previousLayoutSources(root: string): string[] {
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

/** Initializes only the current layout; previous stores remain untouched. */
export function ensureWorkspaceMetadataDirectory(workspacePath: string): string {
  const workspace = path.resolve(workspacePath)
  if (!fs.statSync(workspace).isDirectory()) throw new Error(`Workspace is not a directory: ${workspace}`)
  const root = path.join(workspace, '.onlyrag')
  if (fs.existsSync(root)) assertDirectoryWithoutLink(root)
  const layoutFile = path.join(root, 'layout.json')
  assertFileWithoutLink(layoutFile)
  if (fs.existsSync(root) && previousLayoutSources(root).length > 0) throw new Error('Unsupported previous OnlyRag metadata layout; originals preserved')
  if (fs.existsSync(layoutFile)) {
    const layout = JSON.parse(fs.readFileSync(layoutFile, 'utf-8')) as { version?: number }
    if (layout.version !== LAYOUT_VERSION) throw new Error(`Unsupported OnlyRag metadata layout: ${layout.version}`)
    const ignoreFile = path.join(root, '.gitignore')
    assertFileWithoutLink(ignoreFile)
    if (!fs.existsSync(ignoreFile)) fs.writeFileSync(ignoreFile, IGNORE_ALL, 'utf-8')
    return root
  }
  if (fs.existsSync(root) && fs.readdirSync(root).some((name) => name !== '.gitignore'))
    throw new Error('Unsupported unversioned OnlyRag metadata layout; originals preserved')
  assertDirectoryWithoutLink(root)
  const ignoreFile = path.join(root, '.gitignore')
  assertFileWithoutLink(ignoreFile)
  if (!fs.existsSync(ignoreFile)) fs.writeFileSync(ignoreFile, IGNORE_ALL, 'utf-8')
  const temporaryLayout = `${layoutFile}.tmp-${process.pid}`
  fs.writeFileSync(temporaryLayout, `${JSON.stringify({ version: LAYOUT_VERSION })}\n`, 'utf-8')
  fs.renameSync(temporaryLayout, layoutFile)
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

/** Computes the existing session location without creating or migrating workspace metadata. */
export function workspaceSessionRecoveryPath(workspacePath: string, sessionId: string): string {
  return path.join(path.resolve(workspacePath), '.onlyrag', 'sessions', sessionKey(sessionId))
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
