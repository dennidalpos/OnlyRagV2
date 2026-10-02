// @vitest-environment happy-dom
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { I18nProvider } from '../../src/i18n'
import { DEFAULT_APP_SETTINGS } from '../../shared/domain/settings/appSettingsDefaults'
import type { IngestedDocumentContent, VectorSearchResult, SourceLocation, RunningModelInfo, ChatMessage } from '../../shared/types'
import type { OllamaStreamRequest } from '../../shared/ipc/ipcContract'

const fixture = vi.hoisted(() => ({ document: null as IngestedDocumentContent | null, language: 'en' as 'en' | 'it' }))
vi.mock('../../src/hooks/useIngestedDocuments', () => ({ useIngestedDocuments: () => ({ documents: [fixture.document], refetchDocuments: vi.fn() }) }))
vi.mock('../../src/hooks/useOllamaModelMetrics', () => ({ useOllamaModelMetrics: () => ({ metrics: {} }) }))
vi.mock('../../electron/core/infrastructure/logging/logger', () => ({ logger: { log: vi.fn() } }))

import { useChatEngine } from '../../src/hooks/useChatEngine'
import { OllamaHttpClient } from '../../electron/core/infrastructure/http/ollamaHttpClient'
import { sourceLocationRequest } from '../../src/services/chatSourceReferences'

interface CorpusCase {
  case: { id: string; language: 'en' | 'it'; query: string; expected: string; requiresCitation: boolean }
  document: { id: string; filename: string; extracted_markdown: string; num_pages: number }
  results: VectorSearchResult[]
  locations: Record<string, SourceLocation>
}

it('captures actual retrieval and real 9B citations for independent content review', async () => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const model = 'qwen3.5:9b'
  const host = 'http://127.0.0.1:11434'
  const evidence = path.join(
    process.env.ONLYRAG_LIVE_ROOT || path.join(os.homedir(), 'OnlyRag-Live'),
    `source-provenance-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`,
  )
  fs.mkdirSync(evidence, { recursive: true })
  fs.copyFileSync('sidecar/tests/fixtures/source-provenance-cases.json', path.join(evidence, 'cases.json'))
  console.log(`Evidence: ${evidence}`)
  const python = path.resolve('.venv', process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'python.exe' : 'python')
  const preparation = spawnSync(python, ['scripts/live/sourceProvenanceCorpus.py', evidence], {
    encoding: 'utf8',
    timeout: 120_000,
    windowsHide: true,
  })
  fs.writeFileSync(path.join(evidence, 'preparation.log'), `${preparation.stdout || ''}\n${preparation.stderr || ''}`, 'utf8')
  expect(preparation.error).toBeUndefined()
  expect(preparation.status).toBe(0)
  const cases: CorpusCase[] = JSON.parse(fs.readFileSync(path.join(evidence, 'bundle.json'), 'utf8'))
  const installed = await fetch(`${host}/api/tags`).then(async (response) => {
    expect(response.ok).toBe(true)
    return response.json() as Promise<{ models: RunningModelInfo[] }>
  })
  const modelFacts = installed.models.find((item) => item.name === model)
  expect(modelFacts).toBeDefined()
  const client = new OllamaHttpClient()
  const report: { model: unknown; runtime: unknown; sourceSha256: Record<string, string>; cases: unknown[]; semanticReview: null } = {
    model: modelFacts,
    runtime: await fetch(`${host}/api/version`).then((response) => response.json()),
    sourceSha256: {},
    cases: [],
    semanticReview: null,
  }
  for (const file of [
    'src/hooks/useChatEngine.ts',
    'src/services/chatSourceReferences.ts',
    'sidecar/infrastructure/source_provenance.py',
    'scripts/live/sourceProvenance.live.ts',
    'scripts/live/sourceProvenanceCorpus.py',
  ]) {
    report.sourceSha256[file] = createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  }
  let chat!: ReturnType<typeof useChatEngine>
  function Harness() {
    chat = useChatEngine(
      {
        ...DEFAULT_APP_SETTINGS,
        language: fixture.language,
        defaultModel: model,
        modelContextLengths: { [model]: 8192 },
        modelThinkingPreferences: { [model]: false },
      },
      null,
    )
    return null
  }
  try {
    for (const item of cases) {
      localStorage.clear()
      fixture.language = item.case.language
      fixture.document = {
        id: item.document.id,
        filename: item.document.filename,
        extractedMarkdown: item.document.extracted_markdown,
        fileType: 'pdf',
        numPages: item.document.num_pages,
        ingestedAt: '2026-10-02',
        filePath: `${item.case.id}.pdf`,
        fileSize: 1,
        numChunks: item.results.length,
        status: 'indexed',
      }
      let request: OllamaStreamRequest | undefined
      const api: Pick<NonNullable<Window['electronAPI']>, 'getIngestedDocuments' | 'getIngestedDocument' | 'searchVectorDb' | 'generateOllamaStream'> = {
        getIngestedDocuments: async () => [fixture.document!],
        getIngestedDocument: async () => fixture.document,
        searchVectorDb: async () => item.results,
        generateOllamaStream: async (payload, onChunk, onDone) => {
          request = payload
          return client.generateStream(payload.model, payload.prompt, onChunk, onDone || (() => {}), payload.options, host, payload.operationId)
        },
      }
      Object.assign(window, { electronAPI: api })
      const root = createRoot(document.createElement('div'))
      try {
        await act(async () => root.render(createElement(I18nProvider, { initialLanguage: fixture.language, children: createElement(Harness) })))
        await act(async () => {
          chat.toggleDocSelection(item.document.id)
          chat.setInput(item.case.query)
        })
        await act(async () => chat.handleSendMessage())
        const answer: ChatMessage = chat.messages.at(-1)!
        const cited = answer.sources?.filter((source) => source.citationState === 'cited') || []
        const locations = cited.map((citation) => ({ request: sourceLocationRequest(citation), original: item.locations[citation.chunkId] }))
        report.cases.push({ ...item.case, request, answer, locations })
        fs.writeFileSync(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8')
        expect(request?.model).toBe(model)
        expect(answer.text.trim()).not.toBe('')
        expect(answer.invalidSourceReferences).toEqual([])
        if (item.case.requiresCitation) expect(cited.length).toBeGreaterThan(0)
        for (const location of locations) {
          expect(location.request?.chunkId).toBe(location.original.chunk_id)
          expect(location.request?.sourceRevision).toBe(location.original.source_revision)
        }
        console.log(`${item.case.id}: ${answer.text}`)
      } finally {
        await act(async () => root.unmount())
      }
    }
  } finally {
    fs.writeFileSync(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8')
    localStorage.clear()
    fixture.document = null
    window.electronAPI = undefined
  }
}, 240_000)
