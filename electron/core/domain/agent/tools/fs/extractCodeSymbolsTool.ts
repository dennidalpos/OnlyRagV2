import path from 'node:path'
import type { AgentToolCall } from '../../agentTypes'
import { validatePathSafety } from '../../contextFilter'
import type { ToolExecutionResult } from '../toolExecutionContracts'
import { toolLog } from '../toolExecutionContracts'

export interface CodeSymbolsRepository {
  extractCodeSymbols(
    absolutePath: string,
    filterKind?: string,
  ): Promise<{
    success: boolean
    symbols?: Array<{ startLine: number; kind: string; name: string; signature: string }>
    error?: string
  }>
}

export async function executeExtractCodeSymbolsTool(
  parameters: AgentToolCall['parameters'],
  workspacePath: string | null | undefined,
  repository: CodeSymbolsRepository,
): Promise<ToolExecutionResult> {
  const targetPath = parameters.filePath
  const pathCheck = validatePathSafety(targetPath, workspacePath)
  if (!pathCheck.safePath) {
    return {
      outcome: 'rejected',
      outputForHistory: `Security Violation: ${pathCheck.error}`,
      ...toolLog('toolEditPathRejected', { tool: 'extract_code_symbols', error: String(pathCheck.error) }),
    }
  }

  const filterKind = parameters.symbolType || parameters.kind
  const result = await repository.extractCodeSymbols(pathCheck.safePath, filterKind)
  if (result.success && result.symbols) {
    if (result.symbols.length === 0) {
      const output = `[CODE SYMBOLS: ${targetPath}]\nNo symbols (functions, classes, interfaces) matching filter '${filterKind || 'all'}' found in file.\n[END CODE SYMBOLS]`
      return {
        outcome: 'success',
        outputForHistory: output,
        ...toolLog('toolSymbolsNone', { file: path.basename(pathCheck.safePath) }),
      }
    }

    const formatted = result.symbols.map((symbol) => `Line ${symbol.startLine}: [${symbol.kind}] ${symbol.name} -> \`${symbol.signature}\``).join('\n')
    const output = `[CODE SYMBOLS: ${targetPath} (${result.symbols.length} symbols found)]\n${formatted}\n[END CODE SYMBOLS]`
    return {
      outcome: 'success',
      outputForHistory: output,
      ...toolLog('toolSymbolsFound', { count: result.symbols.length, file: path.basename(pathCheck.safePath) }),
      logDetail: formatted.slice(0, 600),
    }
  }

  return {
    outcome: 'failure',
    outputForHistory: `Error: Extracting code symbols failed: ${result.error || targetPath}`,
    ...toolLog('toolSymbolsError', { error: String(result.error || targetPath) }),
  }
}
