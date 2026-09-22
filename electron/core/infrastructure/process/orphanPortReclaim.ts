

/** Extracts the PID of the process LISTENING on `port` from `netstat -ano` output. */
export function parseListeningPidFromNetstat(output: string, port: number): number | null {
  if (!output) return null

  for (const rawLine of output.split(/\r?\n/)) {
    const tokens = rawLine.trim().split(/\s+/)
    // proto, local address, foreign address, state, pid
    if (tokens.length < 5) continue
    if (!/^tcp$/i.test(tokens[0])) continue
    if (!/^listening$/i.test(tokens[3])) continue

    // Matches both `127.0.0.1:8000` and the IPv6 form `[::]:8000`, without matching :18000.
    const localAddress = tokens[1]
    const separator = localAddress.lastIndexOf(':')
    if (separator < 0 || localAddress.slice(separator + 1) !== String(port)) continue

    const pid = Number.parseInt(tokens[4], 10)
    if (Number.isFinite(pid) && pid > 0) return pid
  }

  return null
}

export interface SidecarOwnershipMarker {
  pid: number
  executablePath: string
  startedAt: string
}

/** PID alone is insufficient: reject reused PIDs and unrelated Python processes. */
export function matchesSidecarOwnership(marker: SidecarOwnershipMarker | null, current: SidecarOwnershipMarker | null): boolean {
  return Boolean(marker && current
    && marker.pid === current.pid
    && marker.executablePath.toLowerCase() === current.executablePath.toLowerCase()
    && marker.startedAt === current.startedAt)
}
