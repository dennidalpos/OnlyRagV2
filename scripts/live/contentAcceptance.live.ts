// @vitest-environment happy-dom
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { I18nProvider } from '../../src/i18n'
import { DEFAULT_APP_SETTINGS } from '../../shared/domain/settings/appSettingsDefaults'
import type { ChatMessage, IngestedDocumentContent, SourceLocation, VectorSearchResult } from '../../shared/types'
import type { OllamaStreamRequest } from '../../shared/ipc/ipcContract'

const fixture = vi.hoisted(() => ({ documents: [] as IngestedDocumentContent[], language: 'en' as 'en' | 'it' }))
vi.mock('../../src/hooks/useIngestedDocuments', () => ({
  useIngestedDocuments: () => ({ documents: fixture.documents, refetchDocuments: vi.fn() }),
}))
vi.mock('../../src/hooks/useOllamaModelMetrics', () => ({ useOllamaModelMetrics: () => ({ metrics: {} }) }))
vi.mock('../../electron/core/infrastructure/logging/logger', () => ({ logger: { log: vi.fn() } }))

import { useChatEngine } from '../../src/hooks/useChatEngine'
import { OllamaHttpClient } from '../../electron/core/infrastructure/http/ollamaHttpClient'
import { sourceLocationRequest } from '../../src/services/chatSourceReferences'

interface CorpusCase {
  case: { id: string; language: 'en' | 'it'; text: string; expected: string; selected: string[] }
  documents: { id: string; filename: string; extracted_markdown: string; num_pages: number }[]
  results: VectorSearchResult[]
  locations: Record<string, SourceLocation | null>
}

it('collects frozen content outcomes using actual Nomic retrieval and production chat with real 9B', async () => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const evidence = path.join(
    process.env.ONLYRAG_LIVE_ROOT || path.join(os.homedir(), 'OnlyRag-Live'),
    `content-acceptance-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`,
  )
  fs.mkdirSync(evidence, { recursive: true })
  console.log(`Evidence: ${evidence}`)
  const python = path.resolve('.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
  await new Promise<void>((resolve, reject) => {
    const log = fs.createWriteStream(path.join(evidence, 'preparation.log'))
    const child = spawn(python, ['scripts/live/contentAcceptanceCorpus.py', evidence], { windowsHide: true, timeout: 120_000 })
    child.stdout.pipe(log, { end: false })
    child.stderr.pipe(log, { end: false })
    child.once('error', reject)
    child.once('close', (code) => {
      log.end()
      if (code === 0) resolve()
      else reject(new Error(`Corpus collection exited ${code}; inspect ${evidence}/preparation.log`))
    })
  })
  const cases: CorpusCase[] = JSON.parse(fs.readFileSync(path.join(evidence, 'bundle.json'), 'utf8'))
  const preparation: { complete: boolean; corpus_sha256: string; mechanical_acceptance: boolean } = JSON.parse(
    fs.readFileSync(path.join(evidence, 'preparation.json'), 'utf8'),
  )
  expect(preparation.complete).toBe(true)
  const client = new OllamaHttpClient()
  const host = 'http://127.0.0.1:11434'
  const model = 'qwen3.5:9b'
  const report: {
    corpus_sha256: string
    source_sha256: Record<string, string>
    cases: unknown[]
    semantic_review: null
    complete: boolean
  } = { corpus_sha256: preparation.corpus_sha256, source_sha256: {}, cases: [], semantic_review: null, complete: false }
  for (const file of ['scripts/live/contentAcceptance.live.ts', 'src/hooks/useChatEngine.ts', 'src/services/chatSourceReferences.ts']) {
    report.source_sha256[file] = createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  }
  const save = () => fs.writeFileSync(path.join(evidence, 'answers.json'), JSON.stringify(report, null, 2) + '\n', 'utf8')
  let chat!: ReturnType<typeof useChatEngine>
  function Harness() {
    chat = useChatEngine(
      {
        ...DEFAULT_APP_SETTINGS,
        language: fixture.language,
        defaultModel: model,
        chatModel: model,
        modelContextLengths: { [model]: 4096 },
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
      fixture.documents = item.documents.map((document) => ({
        id: document.id,
        filename: document.filename,
        extractedMarkdown: document.extracted_markdown,
        fileType: document.filename.endsWith('.pdf') ? 'pdf' : 'text',
        numPages: document.num_pages,
        ingestedAt: '2026-10-02',
        filePath: document.filename,
        fileSize: 1,
        numChunks: item.results.filter((result) => result.doc_id === document.id).length,
        status: 'indexed',
      }))
      let request: OllamaStreamRequest | undefined
      const api: Pick<NonNullable<Window['electronAPI']>, 'getIngestedDocuments' | 'getIngestedDocument' | 'searchVectorDb' | 'generateOllamaStream'> = {
        getIngestedDocuments: async () => fixture.documents,
        getIngestedDocument: async ({ docId }) => fixture.documents.find((document) => document.id === docId) || null,
        searchVectorDb: async ({ topK, docIds, query }) => {
          expect(query).toBe(item.case.text)
          expect(new Set(docIds)).toEqual(new Set(item.documents.map((document) => document.id)))
          expect(topK).toBe(3)
          return item.results
        },
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
          for (const document of item.documents) chat.toggleDocSelection(document.id)
          chat.setInput(item.case.text)
        })
        await act(async () => chat.handleSendMessage())
        const answer: ChatMessage = chat.messages.at(-1)!
        const cited = answer.sources?.filter((source) => source.citationState === 'cited') || []
        const locations = cited.map((source) => ({ request: sourceLocationRequest(source), original: item.locations[source.chunkId] }))
        report.cases.push({ ...item.case, request, answer, locations })
        save()
        expect(request?.model).toBe(model)
        expect(request?.options?.num_ctx).toBe(4096)
        expect(request?.options?.think).toBe(false)
        expect(answer.text.trim()).not.toBe('')
        console.log(`${item.case.id}: ${answer.text}`)
      } finally {
        await act(async () => root.unmount())
      }
    }
    report.complete = true
  } finally {
    save()
    localStorage.clear()
    fixture.documents = []
    window.electronAPI = undefined
  }
  // A successful capture is not semantic acceptance; the separate review gate must pass.
}, 300_000)
