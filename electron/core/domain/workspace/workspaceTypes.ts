export interface ProjectFile {
  name: string
  path: string
  isDirectory: boolean
  sizeBytes?: number
  children?: ProjectFile[]
}

export interface GrepMatchLine {
  line: number
  content: string
}

export interface GrepSearchResult {
  filePath: string
  relativePath: string
  matches: GrepMatchLine[]
}

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
