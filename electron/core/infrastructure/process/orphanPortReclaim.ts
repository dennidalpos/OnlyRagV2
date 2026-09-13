

/** Executable names a reclaim may terminate. */
const RECLAIMABLE_IMAGES = new Set(['sidecar.exe', 'python.exe', 'pythonw.exe', 'python3.exe', 'python'])

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

/**
 * Extracts the image name from `tasklist /FI "PID eq N" /FO CSV /NH` output
 * (e.g. `"python.exe","13664","Console","1","45.000 K"`).
 */
export function parseImageNameFromTasklist(output: string): string | null {
  if (!output) return null

  const firstRow = output.split(/\r?\n/).find((line) => line.trim().length > 0)
  if (!firstRow) return null

  // tasklist reports a missing PID on stdout with exit code 0, and that notice is LOCALISED ("INFO: No tasks..." / "Informazioni: nessuna attività..."), so its text cannot be matched.
  const match = firstRow.trim().match(/^"([^"]+)"/)
  const imageName = match ? match[1].trim() : null

  return imageName || null
}

/** Whether a process holding the port may be terminated to reclaim it. */
export function isReclaimableSidecarImage(imageName: string | null | undefined): boolean {
  if (!imageName) return false
  return RECLAIMABLE_IMAGES.has(imageName.trim().toLowerCase())
}

export type ReclaimDecision =
  | { action: 'kill'; pid: number }
  | { action: 'skip'; reason: string }

/** Decides what to do with the process found holding the sidecar's port. */
export function decidePortReclaim(params: {
  pid: number | null
  imageName: string | null
  ownPid: number
}): ReclaimDecision {
  const { pid, imageName, ownPid } = params

  if (pid === null) return { action: 'skip', reason: 'no listening process could be resolved for the port' }
  if (pid === ownPid) return { action: 'skip', reason: 'the port is held by this very process' }
  if (!isReclaimableSidecarImage(imageName)) {
    return { action: 'skip', reason: `process ${pid} runs "${imageName || 'unknown'}", which is not a known sidecar image` }
  }

  return { action: 'kill', pid }
}
