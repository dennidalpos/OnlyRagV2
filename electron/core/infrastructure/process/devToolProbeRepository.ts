import { execFileSync } from 'node:child_process'

/** Probes a CLI tool's version by running its version command; null means not installed/not resolvable. */
export class DevToolProbeRepository {
  probeVersion(binary: string, versionArgs: string[]): string | null {
    try {
      const stdout = execFileSync(binary, versionArgs, {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      })
      return String(stdout)
    } catch {
      return null
    }
  }
}

export const devToolProbeRepository = new DevToolProbeRepository()
