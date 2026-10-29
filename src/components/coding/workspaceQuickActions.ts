import { WorkspaceFile } from '../../types'
import { translate } from '../../i18n/I18nContext'

export interface WorkspaceQuickAction {
  id: string
  label: string
  command: string
  description?: string
}

/**
 * Dynamically resolves compatible quick action commands based on the detected project stack
 * in the active workspace. Returns empty if no project is attached or no manifest is found.
 */
export function resolveWorkspaceQuickActions(workspacePath?: string | null, files: WorkspaceFile[] = []): WorkspaceQuickAction[] {
  if (!workspacePath || files.length === 0) {
    return []
  }

  const fileNames = new Set(files.map((f) => f.name.toLowerCase()))
  const actions: WorkspaceQuickAction[] = []

  // Node.js / TypeScript / JavaScript ecosystem
  if (fileNames.has('package.json')) {
    const hasTypeScript = fileNames.has('tsconfig.json') || files.some((f) => f.name.endsWith('.ts') || f.name.endsWith('.tsx'))
    if (hasTypeScript) {
      actions.push({
        id: 'typecheck',
        label: 'npm run typecheck',
        command: 'npm run typecheck',
        description: translate('services.actionTypecheck'),
      })
    }
    actions.push({
      id: 'test',
      label: 'npm test',
      command: 'npm test',
      description: translate('services.actionUnitTests'),
    })
    actions.push({
      id: 'build',
      label: 'npm run build',
      command: 'npm run build',
      description: translate('services.actionBuild'),
    })
  }

  // Rust / Cargo ecosystem
  if (fileNames.has('cargo.toml')) {
    actions.push({
      id: 'cargo-check',
      label: 'cargo check',
      command: 'cargo check',
      description: translate('services.actionCargoCheck'),
    })
    actions.push({
      id: 'cargo-test',
      label: 'cargo test',
      command: 'cargo test',
      description: translate('services.actionRustTests'),
    })
  }

  // Python ecosystem
  if (fileNames.has('pyproject.toml') || fileNames.has('requirements.txt') || fileNames.has('pytest.ini') || fileNames.has('setup.py')) {
    actions.push({
      id: 'pytest',
      label: 'pytest',
      command: 'pytest',
      description: translate('services.actionPythonTests'),
    })
  }

  // Go ecosystem
  if (fileNames.has('go.mod')) {
    actions.push({
      id: 'go-test',
      label: 'go test ./...',
      command: 'go test ./...',
      description: translate('services.actionGoTests'),
    })
  }

  // Git status (always available when workspace has files)
  actions.push({
    id: 'git-status',
    label: 'git status',
    command: 'git status',
    description: translate('uiShell.actionGitStatus'),
  })

  return actions.slice(0, 4)
}
