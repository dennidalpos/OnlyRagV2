import fs from 'node:fs'
import path from 'node:path'
import { logger } from '../logging/logger'
import { errorMessage } from '../../../../shared/domain/errors/errorMessage'

const IGNORE_ALL = '# Written by OnlyRag: local agent state (sessions, checkpoints), never committed.\n*\n'

/**
 * Creates the workspace's `.onlyrag/` folder with a `.gitignore` that ignores everything in it, the
 * way `.pytest_cache` does. Agent runs edit the user's workspace in place, and their session state
 * and checkpoints must not show up as untracked changes in the user's repository.
 */
export function ensureWorkspaceMetadataDirectory(workspacePath: string): string {
  const directory = path.join(workspacePath, '.onlyrag')
  try {
    fs.mkdirSync(directory, { recursive: true })
    const ignoreFile = path.join(directory, '.gitignore')
    if (!fs.existsSync(ignoreFile)) fs.writeFileSync(ignoreFile, IGNORE_ALL, 'utf-8')
  } catch (error: unknown) {
    logger.log('WARN', 'WorkspaceMetadata', `Could not prepare ${directory}: ${errorMessage(error)}`)
  }
  return directory
}
