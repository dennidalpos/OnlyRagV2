import path from 'node:path'
import type { AgentToolCall } from '../../agentTypes'
import { validatePathSafety } from '../../contextFilter'
import type { ToolExecutionResult } from '../toolExecutionContracts'

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
      outputForHistory: `Security Violation: ${pathCheck.error}`,
      logMessage: `Extract Code Symbols Rejected: ${pathCheck.error}`,
    }
  }

  const filterKind = parameters.symbolType || parameters.kind
  const result = await repository.extractCodeSymbols(pathCheck.safePath, filterKind)
  if (result.success && result.symbols) {
    if (result.symbols.length === 0) {
      const output = `[CODE SYMBOLS: ${targetPath}]\nNo symbols (functions, classes, interfaces) matching filter '${filterKind || 'all'}' found in file.\n[END CODE SYMBOLS]`
      return {
        outputForHistory: output,
        logMessage: `Code Symbols: 0 found in ${path.basename(pathCheck.safePath)}`,
      }
    }

    const formatted = result.symbols
      .map((symbol) => `Line ${symbol.startLine}: [${symbol.kind}] ${symbol.name} -> \`${symbol.signature}\``)
      .join('\n')
    const output = `[CODE SYMBOLS: ${targetPath} (${result.symbols.length} symbols found)]\n${formatted}\n[END CODE SYMBOLS]`
    return {
      outputForHistory: output,
      logMessage: `Code Symbols: ${result.symbols.length} symbols in ${path.basename(pathCheck.safePath)}`,
      logDetail: formatted.slice(0, 600),
    }
  }

  return {
    outputForHistory: `Error: Extracting code symbols failed: ${result.error || targetPath}`,
    logMessage: `Code Symbols Error: ${result.error || targetPath}`,
  }
}
