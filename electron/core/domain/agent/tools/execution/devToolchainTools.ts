import {
  DEV_TOOL_ALLOWLIST,
  extractVersion,
  type DevToolStatus,
} from '../../devToolchain'

export type VersionProbe = (binary: string, versionArgs: string[]) => string | null

/** Builds the host toolchain inventory from an injected executable probe. */
export function probeDevTool(toolId: string, probeVersion: VersionProbe): DevToolStatus {
  const definition = DEV_TOOL_ALLOWLIST.find((tool) => tool.id === toolId)
  if (!definition) return { id: toolId, displayName: toolId, installed: false, probeError: 'Not allow-listed' }

  const stdout = probeVersion(definition.binary, definition.versionArgs)
  if (stdout === null) return { id: definition.id, displayName: definition.displayName, installed: false }

  const version = extractVersion(stdout)
  // The Windows Store python stub exits 0 while printing nothing: no version means no tool.
  if (!version) return { id: definition.id, displayName: definition.displayName, installed: false }
  return { id: definition.id, displayName: definition.displayName, installed: true, version }
}

export function probeToolchain(probeVersion: VersionProbe): DevToolStatus[] {
  return DEV_TOOL_ALLOWLIST.map((tool) => probeDevTool(tool.id, probeVersion))
}
