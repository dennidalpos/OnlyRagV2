import { WorkspaceFile } from '../../types'

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
export function resolveWorkspaceQuickActions(
  workspacePath?: string | null,
  files: WorkspaceFile[] = []
): WorkspaceQuickAction[] {
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
        description: 'Verifica statica TypeScript',
      })
    }
    actions.push({
      id: 'test',
      label: 'npm test',
      command: 'npm test',
      description: 'Esegui test unitari',
    })
    actions.push({
      id: 'build',
      label: 'npm run build',
      command: 'npm run build',
      description: 'Compila progetto',
    })
  }

  // Rust / Cargo ecosystem
  if (fileNames.has('cargo.toml')) {
    actions.push({
      id: 'cargo-check',
      label: 'cargo check',
      command: 'cargo check',
      description: 'Verifica compilazione Rust',
    })
    actions.push({
      id: 'cargo-test',
      label: 'cargo test',
      command: 'cargo test',
      description: 'Esegui test Rust',
    })
  }

  // Python ecosystem
  if (fileNames.has('pyproject.toml') || fileNames.has('requirements.txt') || fileNames.has('pytest.ini') || fileNames.has('setup.py')) {
    actions.push({
      id: 'pytest',
      label: 'pytest',
      command: 'pytest',
      description: 'Esegui test Python',
    })
  }

  // Go ecosystem
  if (fileNames.has('go.mod')) {
    actions.push({
      id: 'go-test',
      label: 'go test ./...',
      command: 'go test ./...',
      description: 'Esegui test Go',
    })
  }

  // Git status (always available when workspace has files)
  actions.push({
    id: 'git-status',
    label: 'git status',
    command: 'git status',
    description: 'Verifica stato Git',
  })

  return actions.slice(0, 4)
}
