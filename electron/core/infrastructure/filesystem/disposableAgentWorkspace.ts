import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

type EntryType = 'file' | 'directory'

interface WorkspaceEntry {
  type: EntryType
  hash?: string
}

export interface WorkspacePublicationPreview {
  changedPaths: string[]
  createdCount: number
  deletedCount: number
  modifiedCount: number
}

export interface WorkspacePublicationResult {
  success: boolean
  changedPaths: string[]
  error?: string
}

const IGNORED_DIRECTORY_NAMES = new Set(['.git', 'node_modules'])

function hashFile(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function entryAt(root: string, relativePath: string): WorkspaceEntry | undefined {
  const target = path.join(root, relativePath)
  if (!fs.existsSync(target)) return undefined
  const stat = fs.lstatSync(target)
  if (stat.isSymbolicLink()) throw new Error(`Symbolic links are not supported in an agent workspace: ${relativePath}`)
  if (stat.isDirectory()) return { type: 'directory' }
  if (stat.isFile()) return { type: 'file', hash: hashFile(target) }
  return undefined
}

function scanWorkspace(root: string): Map<string, WorkspaceEntry> {
  const entries = new Map<string, WorkspaceEntry>()
  const visit = (directory: string, relativeDirectory: string) => {
    for (const child of fs.readdirSync(directory, { withFileTypes: true })) {
      if (IGNORED_DIRECTORY_NAMES.has(child.name)) continue
      const relativePath = relativeDirectory ? path.join(relativeDirectory, child.name) : child.name
      const absolutePath = path.join(directory, child.name)
      if (child.isSymbolicLink()) throw new Error(`Symbolic links are not supported in an agent workspace: ${relativePath}`)
      if (child.isDirectory()) {
        entries.set(relativePath, { type: 'directory' })
        visit(absolutePath, relativePath)
      } else if (child.isFile()) {
        entries.set(relativePath, { type: 'file', hash: hashFile(absolutePath) })
      }
    }
  }
  visit(root, '')
  return entries
}

function sameEntry(left: WorkspaceEntry | undefined, right: WorkspaceEntry | undefined): boolean {
  return left?.type === right?.type && left?.hash === right?.hash
}

function isGitWorkspace(workspacePath: string): boolean {
  try {
    return (
      execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
        cwd: workspacePath,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5000,
      }).trim() === 'true'
    )
  } catch {
    return false
  }
}

function mirrorWorkspace(sourceRoot: string, destinationRoot: string): void {
  const sourceEntries = scanWorkspace(sourceRoot)
  const destinationEntries = scanWorkspace(destinationRoot)

  for (const relativePath of [...destinationEntries.keys()].sort((a, b) => b.length - a.length)) {
    if (sourceEntries.has(relativePath)) continue
    const target = path.join(destinationRoot, relativePath)
    const entry = destinationEntries.get(relativePath)
    if (entry?.type === 'directory') fs.rmdirSync(target)
    else fs.unlinkSync(target)
  }

  for (const [relativePath, entry] of sourceEntries) {
    const target = path.join(destinationRoot, relativePath)
    if (entry.type === 'directory') {
      fs.mkdirSync(target, { recursive: true })
      continue
    }
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(path.join(sourceRoot, relativePath), target)
  }
}

/**
 * A per-run workspace clone. Agent tools never receive the user's live path; publication is
 * an explicit, conflict-checked copy back into that path.
 */
export class DisposableAgentWorkspace {
  public readonly sourcePath: string
  public readonly workspacePath: string
  private readonly rootPath: string
  private readonly isGitWorktree: boolean
  private readonly baseline: Map<string, WorkspaceEntry>
  private disposed = false

  private constructor(sourcePath: string, rootPath: string, workspacePath: string, isGitWorktree: boolean) {
    this.sourcePath = sourcePath
    this.rootPath = rootPath
    this.workspacePath = workspacePath
    this.isGitWorktree = isGitWorktree
    this.baseline = scanWorkspace(sourcePath)
  }

  static create(sourcePath: string, runId: string): DisposableAgentWorkspace {
    const resolvedSource = path.resolve(sourcePath)
    if (!fs.statSync(resolvedSource).isDirectory()) throw new Error('Agent workspace must be an existing directory.')

    const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), `onlyrag-agent-${runId.replace(/[^a-z0-9_-]/gi, '').slice(0, 32) || 'run'}-`))
    const workspacePath = path.join(rootPath, 'workspace')
    const gitWorkspace = isGitWorkspace(resolvedSource)

    try {
      if (gitWorkspace) {
        execFileSync('git', ['worktree', 'add', '--detach', workspacePath, 'HEAD'], {
          cwd: resolvedSource,
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 30000,
        })
        mirrorWorkspace(resolvedSource, workspacePath)
      } else {
        fs.cpSync(resolvedSource, workspacePath, {
          recursive: true,
          filter: (candidate) => !IGNORED_DIRECTORY_NAMES.has(path.basename(candidate)),
        })
      }
      return new DisposableAgentWorkspace(resolvedSource, rootPath, workspacePath, gitWorkspace)
    } catch (error) {
      try {
        fs.rmSync(rootPath, { recursive: true, force: true })
      } catch {}
      throw error
    }
  }

  preview(): WorkspacePublicationPreview {
    const staged = scanWorkspace(this.workspacePath)
    const changedPaths: string[] = []
    let createdCount = 0
    let deletedCount = 0
    let modifiedCount = 0
    const allPaths = new Set([...this.baseline.keys(), ...staged.keys()])
    for (const relativePath of [...allPaths].sort()) {
      const before = this.baseline.get(relativePath)
      const after = staged.get(relativePath)
      if (sameEntry(before, after)) continue
      changedPaths.push(relativePath)
      if (!before) createdCount++
      else if (!after) deletedCount++
      else modifiedCount++
    }
    return { changedPaths, createdCount, deletedCount, modifiedCount }
  }

  publish(): WorkspacePublicationResult {
    const preview = this.preview()
    for (const relativePath of preview.changedPaths) {
      const actual = entryAt(this.sourcePath, relativePath)
      if (!sameEntry(this.baseline.get(relativePath), actual)) {
        return {
          success: false,
          changedPaths: preview.changedPaths,
          error: `Workspace changed outside this run: ${relativePath}. Publication was not applied.`,
        }
      }
    }

    const staged = scanWorkspace(this.workspacePath)
    const deletes = preview.changedPaths.filter((relativePath) => !staged.has(relativePath)).sort((a, b) => b.length - a.length)
    const directories = preview.changedPaths.filter((relativePath) => staged.get(relativePath)?.type === 'directory').sort()
    const files = preview.changedPaths.filter((relativePath) => staged.get(relativePath)?.type === 'file').sort()
    const backupRoot = fs.mkdtempSync(path.join(this.rootPath, 'publish-backup-'))
    const sourceBeforePublish = new Map<string, WorkspaceEntry>()

    for (const relativePath of preview.changedPaths) {
      const entry = entryAt(this.sourcePath, relativePath)
      if (!entry) continue
      sourceBeforePublish.set(relativePath, entry)
      const backupPath = path.join(backupRoot, relativePath)
      if (entry.type === 'directory') fs.mkdirSync(backupPath, { recursive: true })
      else {
        fs.mkdirSync(path.dirname(backupPath), { recursive: true })
        fs.copyFileSync(path.join(this.sourcePath, relativePath), backupPath)
      }
    }

    try {
      for (const relativePath of deletes) {
        const target = path.join(this.sourcePath, relativePath)
        const original = this.baseline.get(relativePath)
        if (original?.type === 'directory') fs.rmdirSync(target)
        else fs.unlinkSync(target)
      }
      for (const relativePath of directories) fs.mkdirSync(path.join(this.sourcePath, relativePath), { recursive: true })
      for (const relativePath of files) {
        const source = path.join(this.workspacePath, relativePath)
        const target = path.join(this.sourcePath, relativePath)
        fs.mkdirSync(path.dirname(target), { recursive: true })
        const temporaryTarget = `${target}.onlyrag-agent-publish-${process.pid}`
        fs.copyFileSync(source, temporaryTarget)
        fs.renameSync(temporaryTarget, target)
      }
      return { success: true, changedPaths: preview.changedPaths }
    } catch (error: unknown) {
      const current = scanWorkspace(this.sourcePath)
      for (const relativePath of preview.changedPaths.sort((a, b) => b.length - a.length)) {
        if (!current.has(relativePath)) continue
        const target = path.join(this.sourcePath, relativePath)
        const entry = current.get(relativePath)
        if (entry?.type === 'directory') fs.rmdirSync(target)
        else fs.unlinkSync(target)
      }
      for (const [relativePath, entry] of [...sourceBeforePublish].sort(([a], [b]) => a.localeCompare(b))) {
        const target = path.join(this.sourcePath, relativePath)
        if (entry.type === 'directory') fs.mkdirSync(target, { recursive: true })
      }
      for (const [relativePath, entry] of [...sourceBeforePublish].sort(([a], [b]) => a.localeCompare(b))) {
        if (entry.type !== 'file') continue
        const target = path.join(this.sourcePath, relativePath)
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.copyFileSync(path.join(backupRoot, relativePath), target)
      }
      return {
        success: false,
        changedPaths: preview.changedPaths,
        error: error instanceof Error ? error.message : String(error),
      }
    } finally {
      fs.rmSync(backupRoot, { recursive: true, force: true })
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    try {
      if (this.isGitWorktree && fs.existsSync(this.workspacePath)) {
        execFileSync('git', ['worktree', 'remove', '--force', this.workspacePath], {
          cwd: this.sourcePath,
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 30000,
        })
      }
    } finally {
      fs.rmSync(this.rootPath, { recursive: true, force: true })
    }
  }
}
