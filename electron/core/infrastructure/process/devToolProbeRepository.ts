import { execFileSync } from 'node:child_process'

const WINDOWS_VERSION_COMMANDS: Readonly<Record<string, string>> = { npm: 'npm --version', pnpm: 'pnpm --version' }

/** Probes a CLI tool's version by running its version command; null means not installed/not resolvable. */
export class DevToolProbeRepository {
  probeVersion(binary: string, versionArgs: string[]): string | null {
    try {
      const command = process.platform === 'win32' ? WINDOWS_VERSION_COMMANDS[binary] : undefined
      if (command && (versionArgs.length !== 1 || versionArgs[0] !== '--version')) return null
      // Only fixed package-manager probes enter cmd; executable paths keep native argv.
      const stdout = execFileSync(command ? 'cmd.exe' : binary, command ? ['/d', '/s', '/c', command] : versionArgs, {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
      })
      return String(stdout)
    } catch {
      return null
    }
  }
}

export const devToolProbeRepository = new DevToolProbeRepository()
