/** Ordinary shell command ceiling. */
export const DEFAULT_COMMAND_TIMEOUT_MS = 120000
/** Package installs and scaffolding routinely exceed the ordinary ceiling. */
export const INSTALL_COMMAND_TIMEOUT_MS = 600000
/** Upper bound for an explicit per-call timeoutSeconds override. */
export const MAX_COMMAND_TIMEOUT_MS = 900000

/** Commands whose normal runtime is measured in minutes, not seconds. */
export function isLongRunningCommand(command: string): boolean {
  const cmd = command.toLowerCase()
  return (
    /\b(npm|pnpm|yarn|bun)\s+(install|ci|add)\b/.test(cmd) ||
    /\bpip3?\s+install\b/.test(cmd) ||
    /\bwinget\s+install\b/.test(cmd) ||
    /\bcargo\s+(build|install)\b/.test(cmd) ||
    /\bdotnet\s+restore\b/.test(cmd) ||
    /\bnpx?\s+create-/.test(cmd) ||
    /\bgit\s+clone\b/.test(cmd)
  )
}

/**
 * Detects a command that starts a dev/watch server or otherwise never exits on its own.
 * run_command waits synchronously for the process to exit, so these commands need an
 * explicit refusal instead of consuming the full timeout ceiling.
 */
function isBlockingDevServerSubcommand(subcmd: string): boolean {
  const cmd = subcmd.trim().toLowerCase()
  if (!cmd) return false

  if (/^(npm|pnpm|yarn|bun)\s+(install|i|add)\b/.test(cmd)) return false

  if (
    /^(npm|pnpm|yarn|bun)\s+(run\s+)?(build|test|lint|typecheck|check|format)\b/.test(cmd) ||
    /^(npx\s+)?(tsc|eslint|prettier|vitest\s+run|jest\s+--runInBand)\b/.test(cmd) ||
    /^(npx\s+)?vite\s+build\b/.test(cmd) ||
    /^(npx\s+)?next\s+build\b/.test(cmd)
  ) return false

  return (
    /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(dev|start|serve|preview)\b/.test(cmd) ||
    (/^(npx\s+)?vite(\.js|\.cmd|\.exe)?(\s+(dev|serve|preview))?$/i.test(cmd)) ||
    (/\bnext\s+(dev|start)\b/.test(cmd)) ||
    /\bng\s+serve\b/.test(cmd) ||
    /\bwebpack(-dev-server)?\s+serve\b/.test(cmd) ||
    /\bnodemon\b/.test(cmd) ||
    /\bflask\s+run\b/.test(cmd) ||
    /-m\s+http\.server\b/.test(cmd) ||
    /--watch(all)?\b/.test(cmd)
  )
}

export function isBlockingDevServerCommand(command: string): boolean {
  return command.split(/[;&|]/).some((subcommand) => isBlockingDevServerSubcommand(subcommand))
}

export function findAlreadyInstalledPackages(requestedNames: string[], packageJsonRaw: string): string[] | null {
  if (requestedNames.length === 0) return null
  let packageJson: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
  try {
    packageJson = JSON.parse(packageJsonRaw)
  } catch {
    return null
  }
  const installed = new Set([...Object.keys(packageJson.dependencies || {}), ...Object.keys(packageJson.devDependencies || {})])
  return requestedNames.every((name) => installed.has(name)) ? requestedNames : null
}

export function resolveCommandTimeoutMs(command: string, timeoutSecondsParam?: unknown): number {
  const explicit = Number(timeoutSecondsParam)
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.min(MAX_COMMAND_TIMEOUT_MS, Math.max(5000, Math.floor(explicit) * 1000))
  }
  return isLongRunningCommand(command) ? INSTALL_COMMAND_TIMEOUT_MS : DEFAULT_COMMAND_TIMEOUT_MS
}
