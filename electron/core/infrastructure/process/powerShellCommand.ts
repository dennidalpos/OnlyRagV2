/** Called only after command security accepts the original declared verification. */
export function withVerificationEnvironment(command: string, projectRootPath?: string): string {
  const manager = /^(npm|pnpm|yarn) run /.exec(command)?.[1]
  const nativeTool = /^(python|go|cargo|mvn|gradle|composer|\.\\\.venv\\Scripts\\python\.exe)\s/.exec(command)?.[1]
  const tool = manager || nativeTool
  const settings = {
    COREPACK_ENABLE_NETWORK: '0',
    YARN_ENABLE_NETWORK: '0',
    // pnpm 12 reads its own prefix while resolving package-manager config dependencies;
    // --pm-on-fail=error and npm_config_offline alone do not prevent metadata requests.
    npm_config_offline: 'true',
    pnpm_config_offline: 'true',
    npm_config_manage_package_manager_versions: 'false',
    npm_config_package_manager_strict_version: 'true',
    npm_config_pm_on_fail: 'error',
    npm_config_runtime_on_fail: 'error',
    GOPROXY: 'off',
    GOSUMDB: 'off',
    GOTOOLCHAIN: 'local',
    CARGO_NET_OFFLINE: 'true',
    PIP_NO_INDEX: '1',
    COMPOSER_DISABLE_NETWORK: '1',
  }
  const entries = Object.entries(settings)
  const save = entries.map(([key], index) => `$__onlyrag_verificationEnv${index} = [Environment]::GetEnvironmentVariable('${key}', 'Process')`).join('; ')
  const apply = entries.map(([key, value]) => `[Environment]::SetEnvironmentVariable('${key}', '${value}', 'Process')`).join('; ')
  const restore = entries.map(([key], index) => `[Environment]::SetEnvironmentVariable('${key}', $__onlyrag_verificationEnv${index}, 'Process')`).join('; ')
  const guardedCommand =
    manager === 'pnpm' ? command.replace(/^pnpm run /, 'pnpm --pm-on-fail=error --runtime-on-fail=error --config.verify-deps-before-run=error run ') : command
  const execute = tool
    ? `if (-not (Get-Command '${tool}' -CommandType Application -ErrorAction SilentlyContinue)) { Write-Error 'VERIFICATION_TOOL_UNAVAILABLE:${tool}'; $global:LASTEXITCODE = 127 } else { ${guardedCommand}; if (-not $? -and $LASTEXITCODE -eq 0) { $global:LASTEXITCODE = 1 } }`
    : `${command}; if (-not $? -and $LASTEXITCODE -eq 0) { $global:LASTEXITCODE = 1 }`
  const scopedEnvironment = `${save}; try { ${apply}; ${execute} } finally { ${restore} }`
  if (projectRootPath === undefined) return scopedEnvironment
  const root = projectRootPath.replace(/'/g, "''")
  // A workspace shell intentionally keeps cd between interactive commands. Verification must
  // instead run at the observed project's root, even if a previous command or test script moved it.
  return (
    `$__onlyrag_verificationLocation = (Get-Location).Path; try { Set-Location -LiteralPath '${root}' -ErrorAction Stop; ${scopedEnvironment} } ` +
    `catch { if ($LASTEXITCODE -eq 0) { $global:LASTEXITCODE = 1 }; Write-Error -Message $_ -ErrorAction Continue } ` +
    `finally { try { Set-Location -LiteralPath $__onlyrag_verificationLocation -ErrorAction Stop } ` +
    `catch { $global:LASTEXITCODE = 1; Write-Error -Message $_ -ErrorAction Continue } }`
  )
}

export function normalizePowerShellCommand(command: string): string {
  if (!command || typeof command !== 'string') return ''
  let normalized = command.trim()

  normalized = normalized.replace(/^npx\s+(?!-y|--yes)(.+)/i, 'npx -y $1')

  if (/^(?:npm\s+create\s+vite\b|npx\s+(?:-y\s+|--yes\s+)?create-vite\b)/i.test(normalized)) {
    if (!normalized.includes('--yes') && !normalized.includes('-y')) {
      if (normalized.includes('--template') && !normalized.includes('-- --template')) {
        normalized = normalized.replace(/--template\s+([^\s]+)/i, '-- --template $1 --yes')
      } else {
        normalized = `${normalized} --yes`
      }
    }
  }

  return rewritePowerShellChains(normalized)
}

/** PS 5.1 compatibility. Read lexical regions before interpreting an operator or separator. */
function rewritePowerShellChains(command: string): string {
  let index = 0
  const singleQuotes = "'\u2018\u2019\u201a\u201b"
  const doubleQuotes = '"\u201c\u201d\u201e'
  const isSingle = (char: string) => !!char && singleQuotes.includes(char)
  const isDouble = (char: string) => !!char && doubleQuotes.includes(char)

  const quoted = (single: boolean): string => {
    let text = command[index++]
    while (index < command.length) {
      const char = command[index++]
      text += char
      if (!single && char === '`') {
        text += command[index++] || ''
        continue
      }
      // Expandable strings may contain nested quoted subexpressions.
      if (!single && char === '$' && command[index] === '(') {
        index++
        text += '(' + region(')')
        continue
      }
      if (single ? isSingle(char) : isDouble(char)) {
        if (single ? isSingle(command[index]) : isDouble(command[index])) text += command[index++]
        else break
      }
    }
    return text
  }

  const region = (closing?: string): string => {
    let text = ''
    let pending = 0
    let awaitingRight = false
    let nativeTail = false
    const finish = () => {
      if (pending && nativeTail) text += '\n'
      text += ' }'.repeat(pending)
      pending = 0
      nativeTail = false
    }
    while (index < command.length) {
      const char = command[index]
      if (char === '`') {
        const length = command.startsWith('`\r\n', index) ? 3 : 2
        text += command.slice(index, index + length)
        index += length
        continue
      }
      if (command.startsWith('${', index)) {
        const start = index
        index += 2
        while (index < command.length && command[index] !== '}') index += command[index] === '`' ? 2 : 1
        if (command[index] === '}') index++
        text += command.slice(start, index)
        awaitingRight = false
        continue
      }
      // Native stop-parsing arguments belong to that executable, including literal &&.
      if (command.startsWith('--%', index) && /\s/.test(command[index - 1] || ' ')) {
        const end = command.indexOf('\n', index)
        const stop = end < 0 ? command.length : end
        text += command.slice(index, stop)
        index = stop
        nativeTail = true
        continue
      }
      if (command.startsWith('<#', index)) {
        const end = command.indexOf('#>', index + 2)
        const stop = end < 0 ? command.length : end + 2
        text += command.slice(index, stop)
        index = stop
        continue
      }
      if (char === '#' && (index === 0 || /[\s;(){}\[\]'"\u2018-\u201e]/u.test(command[index - 1]))) {
        const end = command.indexOf('\n', index)
        // Close before a trailing comment; otherwise generated braces would be commented out.
        if (!awaitingRight && !/[|,=]$/.test(text.trimEnd())) finish()
        const stop = end < 0 ? command.length : end
        text += command.slice(index, stop)
        index = stop
        continue
      }
      if (char === '@' && (isSingle(command[index + 1]) || isDouble(command[index + 1])) && /^@[\s\S][ \t]*\r?\n/.test(command.slice(index))) {
        const start = index
        const quote = command[index + 1]
        index = command.indexOf('\n', index) + 1
        while (index < command.length) {
          if (command[index] === quote && command[index + 1] === '@') {
            index += 2
            break
          }
          const end = command.indexOf('\n', index)
          index = end < 0 ? command.length : end + 1
        }
        text += command.slice(start, index)
        awaitingRight = false
        continue
      }
      if (isSingle(char) || isDouble(char)) {
        text += quoted(isSingle(char))
        awaitingRight = false
        continue
      }
      if (char === closing) {
        finish()
        text += char
        index++
        return text
      }
      const paired = ({ '(': ')', '{': '}', '[': ']' } as Record<string, string>)[char]
      if (paired) {
        index++
        text += char + region(paired)
        awaitingRight = false
        continue
      }
      if (command.startsWith('&&', index)) {
        text = text.trimEnd() + '; if ($?) { '
        index += 2
        while (/[ \t]/.test(command[index] || '\0')) index++
        pending++
        awaitingRight = true
        continue
      }
      if (char === ';' || ((char === '\n' || char === '\r') && !awaitingRight && !/[|,=]$/.test(text.trimEnd()))) finish()
      text += char
      if (!/\s/.test(char)) awaitingRight = false
      index++
    }
    finish()
    return text
  }
  return region()
}
