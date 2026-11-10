import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { ORDER_MARKER } from './diagnosticAdvice'

/**
 * A turn carries at most one order, the arbiter's. Only these modules may word one: the arbiter,
 * the builders only it calls, the focus block that renders its decision and the system prompt.
 * Every other module returns advice (renderAdvice / renderAdviceSteps).
 */
const ORDER_MODULES = new Set([
  'electron/core/domain/agent/planDirectiveArbiter.ts',
  'electron/core/domain/agent/diagnosticAdvice.ts',
  'electron/core/domain/agent/postVerificationClosure.ts',
  'electron/core/domain/agent/behaviorTestDirective.ts',
  'electron/core/domain/agent/entrypointIntegrity.ts',
  'electron/core/domain/agent/verificationAttemptTracker.ts',
  'shared/domain/agent/planAndSolveGraph.ts',
  'shared/domain/agent/promptPresets.ts',
])

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [full] : []
  })
}

/** Order wording outside comments: a comment may quote an old order to explain why it went. */
function orderLines(file: string): string[] {
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line) && ORDER_MARKER.test(line))
}

describe('order authority', () => {
  it('keeps order wording inside the arbiter modules', () => {
    const root = process.cwd()
    const offenders = ['electron', 'shared']
      .flatMap((dir) => sourceFiles(path.join(root, dir)))
      .map((file) => path.relative(root, file).split(path.sep).join('/'))
      .filter((file) => !ORDER_MODULES.has(file))
      .flatMap((file) => orderLines(path.join(root, file)).map((line) => `${file}: ${line.trim().slice(0, 120)}`))

    expect(offenders).toEqual([])
  })
})
