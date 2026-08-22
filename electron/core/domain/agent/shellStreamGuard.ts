const INTERACTIVE_PATTERNS = [
  /\[y\/n\]/i,
  /\(y\/n\)/i,
  /press any key/i,
  /enter configuration/i,
  /password:/i,
  /select an option/i,
  /do you want to continue\?/i,
]

/**
 * Inject mandatory non-interactive shell flags into environment.
 */
export function getNonInteractiveEnv(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    CI: 'true',
    PAGER: 'cat',
    NPM_CONFIG_YES: 'true',
    PIP_NO_INPUT: '1',
    DEBIAN_FRONTEND: 'noninteractive',
    GIT_TERMINAL_PROMPT: '0',
    PYTHONUNBUFFERED: '1',
  }
}

/**
 * Sanitizes Unix-style bash shell commands for execution on Windows PowerShell.
 * Converts bash brace expansions (e.g., mkdir -p src/{a,b}), touch, rm -rf, ls, and chained && commands.
 */
export function sanitizePowerShellCommand(cmd: string): string {
  if (!cmd || typeof cmd !== 'string') return cmd
  let clean = cmd.trim()

  // 1. Expand mkdir -p with brace syntax e.g. mkdir -p src/{package.json, index.html} or mkdir -p dir1 dir2
  clean = clean.replace(/mkdir\s+(?:-p\s+)?([^{\s;]+)\{([^}]+)\}/gi, (_m, prefix, inner) => {
    const items = inner.split(',').map((s: string) => s.trim()).filter(Boolean)
    const paths = items.map((item: string) => `"${prefix}${item}"`).join(', ')
    return `New-Item -ItemType Directory -Force -Path ${paths}`
  })

  // 2. Standard mkdir -p path -> New-Item -ItemType Directory -Force -Path "dirPath"
  clean = clean.replace(/\bmkdir\s+-p\s+([^\s;&|]+)/gi, (_m, dirPath) => {
    return `New-Item -ItemType Directory -Force -Path "${dirPath}"`
  })

  // 3. Convert touch file -> New-Item -ItemType File -Force -Path "file"
  clean = clean.replace(/\btouch\s+([^\s;&|]+)/gi, (_m, filePath) => {
    return `New-Item -ItemType File -Force -Path "${filePath}"`
  })

  // 4. Convert rm -rf target -> Remove-Item -Recurse -Force "target"
  clean = clean.replace(/\brm\s+-rf\s+([^\s;&|]+)/gi, (_m, target) => {
    return `Remove-Item -Recurse -Force "${target}"`
  })

  // 5. Convert ls / ls -la / ls -l -> Get-ChildItem
  if (/^ls(\s+-[a-zA-Z]+)?$/i.test(clean)) {
    clean = 'Get-ChildItem'
  }

  // 6. Convert cd dir && command -> Set-Location "dir"; command
  clean = clean.replace(/\bcd\s+([^\s;&|]+)\s*&&\s*/gi, (_m, dir) => {
    return `Set-Location "${dir}"; `
  })

  return clean
}

/**
 * Scans a chunk of shell output for a pattern indicating the process is blocked on interactive
 * input (a `[y/n]` confirmation, a password prompt, etc.). Returns the matched pattern, or null
 * if the chunk looks like normal output. Used by persistentPowerShellSession.ts to abort a
 * `run_command` invocation immediately instead of waiting out its full timeout — no human is
 * present to answer the prompt in the autonomous agent loop.
 */
export function detectInteractivePrompt(outputChunk: string): RegExp | null {
  for (const pattern of INTERACTIVE_PATTERNS) {
    if (pattern.test(outputChunk)) return pattern
  }
  return null
}
