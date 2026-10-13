/** Called only after command security accepts the original declared verification. */
export function withVerificationEnvironment(command: string): string {
  const manager = /^(npm|pnpm|yarn) run /.exec(command)?.[1]
  const settings = {
    COREPACK_ENABLE_NETWORK: '0',
    YARN_ENABLE_NETWORK: '0',
    npm_config_manage_package_manager_versions: 'false',
    npm_config_package_manager_strict_version: 'true',
    npm_config_pm_on_fail: 'error',
    npm_config_runtime_on_fail: 'error',
  }
  const entries = Object.entries(settings)
  const save = entries.map(([key], index) => `$__onlyrag_verificationEnv${index} = [Environment]::GetEnvironmentVariable('${key}', 'Process')`).join('; ')
  const apply = entries.map(([key, value]) => `[Environment]::SetEnvironmentVariable('${key}', '${value}', 'Process')`).join('; ')
  const restore = entries.map(([key], index) => `[Environment]::SetEnvironmentVariable('${key}', $__onlyrag_verificationEnv${index}, 'Process')`).join('; ')
  const guardedCommand =
    manager === 'pnpm' ? command.replace(/^pnpm run /, 'pnpm --pm-on-fail=error --runtime-on-fail=error --config.verify-deps-before-run=error run ') : command
  const execute = manager
    ? `if (-not (Get-Command '${manager}' -CommandType Application -ErrorAction SilentlyContinue)) { Write-Error 'VERIFICATION_TOOL_UNAVAILABLE:${manager}'; $global:LASTEXITCODE = 127 } else { ${guardedCommand}; if (-not $? -and $LASTEXITCODE -eq 0) { $global:LASTEXITCODE = 1 } }`
    : `${command}; if (-not $? -and $LASTEXITCODE -eq 0) { $global:LASTEXITCODE = 1 }`
  return `${save}; try { ${apply}; ${execute} } finally { ${restore} }`
}

export function normalizePowerShellCommand(command: string): string {
  if (!command || typeof command !== 'string') return ''
  let normalized = command.trim()

  normalized = normalized.replace(/^npx\s+(?!-y|--yes)(.+)/i, 'npx -y $1')

  if (/\bnpm\s+create\s+vite\b/i.test(normalized) || /\bcreate-vite\b/i.test(normalized)) {
    if (!normalized.includes('--yes') && !normalized.includes('-y')) {
      if (normalized.includes('--template') && !normalized.includes('-- --template')) {
        normalized = normalized.replace(/--template\s+([^\s]+)/i, '-- --template $1 --yes')
      } else {
        normalized = `${normalized} --yes`
      }
    }
  }

  if (normalized.includes('&&')) {
    const parts = normalized.split(/\s*&&\s*/)
    if (parts.length > 1) {
      normalized = parts.join('; if ($?) { ') + ' }'.repeat(parts.length - 1)
    }
  }

  return normalized
}
