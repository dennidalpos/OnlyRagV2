export interface GuestOsInfo {
  platform: string
  arch: string
  release?: string
  hostname?: string
  cpuCount: number
  cpuModel?: string
  totalMemoryGB: number
  freeMemoryGB: number
  nodeVersion: string
  electronVersion: string
  tools: {
    git: boolean
    node: boolean
    npm: boolean
    python: boolean
    ollama: boolean
  }
  cpus?: number
  totalMemMb?: number
  freeMemMb?: number
  hasGit?: boolean
  hasNode?: boolean
  hasNpm?: boolean
  hasPython?: boolean
  hasOllama?: boolean
}
