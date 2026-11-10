export interface DevToolDefinition {
  id: string
  displayName: string
  /** Executable to invoke for the version probe. */
  binary: string
  /** Arguments that make the binary print its version and exit. */
  versionArgs: string[]
  /** winget package id, or null when the tool ships with another one. */
  wingetId: string | null
  /** Set when this tool is provided by installing a different allow-listed tool. */
  providedBy?: string
}

export const DEV_TOOL_ALLOWLIST: DevToolDefinition[] = [
  { id: 'node', displayName: 'Node.js', binary: 'node', versionArgs: ['--version'], wingetId: 'OpenJS.NodeJS.LTS' },
  { id: 'npm', displayName: 'npm', binary: 'npm', versionArgs: ['--version'], wingetId: null, providedBy: 'node' },
  { id: 'pnpm', displayName: 'pnpm', binary: 'pnpm', versionArgs: ['--version'], wingetId: 'pnpm.pnpm' },
  { id: 'git', displayName: 'Git', binary: 'git', versionArgs: ['--version'], wingetId: 'Git.Git' },
  { id: 'python', displayName: 'Python 3', binary: 'python', versionArgs: ['--version'], wingetId: 'Python.Python.3.13' },
  { id: 'ollama', displayName: 'Ollama', binary: 'ollama', versionArgs: ['--version'], wingetId: 'Ollama.Ollama' },
]

const TOOL_ALIASES: Record<string, string> = {
  nodejs: 'node',
  'node.js': 'node',
  npx: 'npm',
  python3: 'python',
  py: 'python',
  pip: 'python',
  pip3: 'python',
  'git.git': 'git',
  'ollama.ollama': 'ollama',
}

export interface DevToolStatus {
  id: string
  displayName: string
  installed: boolean
  version?: string
  /** Present when the probe failed for a reason other than the tool being absent. */
  probeError?: string
}

/** Canonical allow-list id for a name the model produced, or null when not allow-listed. */
export function normalizeToolId(rawName: string): string | null {
  const key = String(rawName || '')
    .trim()
    .toLowerCase()
  if (!key) return null
  const aliased = TOOL_ALIASES[key] || key
  return DEV_TOOL_ALLOWLIST.some((tool) => tool.id === aliased) ? aliased : null
}

export function findToolDefinition(rawName: string): DevToolDefinition | null {
  const id = normalizeToolId(rawName)
  return id ? DEV_TOOL_ALLOWLIST.find((tool) => tool.id === id) || null : null
}

/**
 * The tool that actually has to be installed to provide `rawName` — npm, for instance,
 * is delivered by installing Node.js. Returns null when the name is not allow-listed.
 */
export function resolveInstallTarget(rawName: string): DevToolDefinition | null {
  const tool = findToolDefinition(rawName)
  if (!tool) return null
  if (tool.providedBy) {
    return DEV_TOOL_ALLOWLIST.find((candidate) => candidate.id === tool.providedBy) || null
  }
  return tool
}

/** winget invocation for an allow-listed tool. */
export function buildInstallCommand(rawName: string): string | null {
  const target = resolveInstallTarget(rawName)
  if (!target || !target.wingetId) return null
  return `winget install --id ${target.wingetId} --exact --silent --accept-package-agreements --accept-source-agreements`
}

/** First version-looking token in a probe's output (e.g. "git version 2.43.0" -> "2.43.0"). */
export function extractVersion(rawOutput: string): string {
  const text = String(rawOutput || '').trim()
  if (!text) return ''
  const match = text.match(/\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?/)
  return match ? match[0] : text.split(/\r?\n/)[0].slice(0, 40)
}

/** Compact, one-line-per-tool inventory. */
export function formatToolchainInventory(statuses: ReadonlyArray<DevToolStatus>): string {
  if (statuses.length === 0) return 'Toolchain: no tools probed.'

  const lines = statuses.map((status) => (status.installed ? `- ${status.id}: OK (${status.version || 'version unknown'})` : `- ${status.id}: MISSING`))

  const missing = statuses.filter((s) => !s.installed).map((s) => s.id)
  const footer = missing.length
    ? `\nMissing tools: ${missing.join(', ')}. Install one with: { "tool": "ensure_tool", "parameters": { "toolName": "${missing[0]}" } }`
    : '\nAll probed development tools are available.'

  return `DEVELOPMENT TOOLCHAIN:\n${lines.join('\n')}${footer}`
}
