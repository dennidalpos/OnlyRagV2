import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { OllamaHttpClient } from '../../electron/core/infrastructure/http/ollamaHttpClient'
import { assessModelRuntimeFit } from '../../shared/domain/hardware/modelRuntimeFit'

vi.mock('../../electron/core/infrastructure/logging/logger', () => ({ logger: { log: vi.fn() } }))

it('captures installed scalar metadata without generation or server configuration changes', async () => {
  const directory = path.join(
    process.env.ONLYRAG_LIVE_ROOT || path.join(os.homedir(), 'OnlyRag-Live'),
    `model-runtime-fit-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`,
  )
  fs.mkdirSync(directory, { recursive: true })
  const client = new OllamaHttpClient()
  const metrics = await client.getModelMetrics('http://127.0.0.1:11434')
  const version = await fetch('http://127.0.0.1:11434/api/version').then((response) => {
    if (!response.ok) throw new Error(`Version probe failed: ${response.status}`)
    return response.json()
  })
  const assessments = [4096, 16384].map((context) => ({ context, fit: assessModelRuntimeFit('qwen3.5:9b', context, undefined, metrics['qwen3.5:9b']) }))
  fs.writeFileSync(
    path.join(directory, 'report.json'),
    JSON.stringify({ version, metrics, assessments, qualification: 'Metadata capture only; no inference, speed or host-fit certification.' }, null, 2) + '\n',
    'utf8',
  )
  expect(metrics['qwen3.5:9b']?.sizeBytes).toBeGreaterThan(0)
  expect(metrics['qwen3.5:9b']?.memoryGeometry?.layout).toBe('unsupported')
  expect(assessments.every((item) => item.fit.placement === 'unknown')).toBe(true)
  console.log(`Retained metadata: ${directory}`)
}, 30_000)
