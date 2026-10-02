// @vitest-environment happy-dom
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { I18nProvider } from '../../src/i18n'
import { DEFAULT_APP_SETTINGS } from '../../shared/domain/settings/appSettingsDefaults'
import type { IngestedDocumentContent, RunningModelInfo } from '../../shared/types'
import type { OllamaStreamRequest } from '../../shared/ipc/ipcContract'

const fixture = vi.hoisted(() => ({ document: null as IngestedDocumentContent | null, language: 'en' as 'en' | 'it' }))
vi.mock('../../src/hooks/useIngestedDocuments', () => ({ useIngestedDocuments: () => ({ documents: [fixture.document], refetchDocuments: vi.fn() }) }))
vi.mock('../../src/hooks/useOllamaModelMetrics', () => ({ useOllamaModelMetrics: () => ({ metrics: {} }) }))
vi.mock('../../electron/core/infrastructure/logging/logger', () => ({ logger: { log: vi.fn() } }))

import { useChatEngine } from '../../src/hooks/useChatEngine'
import { clearDocumentMarkdownCache } from '../../src/services/documentMarkdown'
import { OllamaHttpClient } from '../../electron/core/infrastructure/http/ollamaHttpClient'

const cases = [
  {
    id: 'absent-it',
    language: 'it',
    text: 'La consegna deve avvenire entro trenta giorni. Il contratto non specifica penali.',
    query: 'Qual è la penale giornaliera per il ritardo nella consegna?',
    score: 0.99,
    expected: 'State that no daily penalty is specified; do not invent a number.',
  },
  {
    id: 'unrelated-en',
    language: 'en',
    text: 'Water the cactus once a month. Keep the pot in sunlight.',
    query: 'What deadline does the document set for paying an invoice?',
    score: 0.99,
    expected: 'State that the supplied text contains no invoice payment deadline.',
  },
  {
    id: 'cross-language',
    language: 'en',
    text: 'Il pagamento della fattura deve essere effettuato entro ventuno giorni dalla ricezione.',
    query: 'When is settlement due after receipt?',
    score: 0.225,
    expected: 'Answer 21 days after receipt, despite zero English term overlap.',
  },
  {
    id: 'paraphrase',
    language: 'en',
    text: 'Notify the supplier no later than forty-eight hours after discovering a defect.',
    query: 'How long do I have to report a newly discovered fault?',
    score: 0.225,
    expected: 'Answer 48 hours or two days after discovery, without changing the trigger.',
  },
  {
    id: 'conditional',
    language: 'it',
    text: 'Il fornitore deve rimborsare il cliente solo dopo la ricezione di una diffida scritta. In assenza di diffida non è dovuto alcun rimborso.',
    query: 'Il documento impone un rimborso anche senza diffida?',
    score: 0.8,
    expected: 'Answer no and preserve the written-notice condition.',
  },
  {
    id: 'contradictory',
    language: 'en',
    text: 'Policy A requires delivery in 15 days. Policy B requires delivery in 30 days. Neither policy specifies which supersedes the other.',
    query: 'What single delivery deadline is authoritative in this document?',
    score: 0.9,
    expected: 'Identify the 15/30-day conflict and abstain from choosing an authoritative deadline.',
  },
] as const

it('records real 9B answers to frozen evidence cases for independent semantic review', async () => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const model = 'qwen3.5:9b'
  const host = 'http://127.0.0.1:11434'
  const evidence = path.join(
    process.env.ONLYRAG_LIVE_ROOT || path.join(os.homedir(), 'OnlyRag-Live'),
    `evidence-scoring-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`,
  )
  fs.mkdirSync(evidence, { recursive: true })
  fs.writeFileSync(path.join(evidence, 'cases.json'), JSON.stringify(cases, null, 2) + '\n', 'utf8')
  const client = new OllamaHttpClient()
  async function installedModels() {
    const response = await fetch(`${host}/api/tags`)
    expect(response.ok).toBe(true)
    return response.json() as Promise<{ models: RunningModelInfo[] }>
  }
  const installed = await installedModels()
  const provenance = installed.models.find((item) => item.name === model)
  expect(provenance).toBeDefined()
  const version = await fetch(`${host}/api/version`).then(async (response) => {
    expect(response.ok).toBe(true)
    return response.json() as Promise<{ version: string }>
  })
  const report: { model: unknown; runtime: unknown; sourceSha256: Record<string, string>; cases: unknown[]; semanticReview: null } = {
    model: provenance,
    runtime: version,
    sourceSha256: {},
    cases: [],
    semanticReview: null,
  }
  for (const source of [
    'scripts/live/evidenceScoring.live.ts',
    'src/hooks/useChatEngine.ts',
    'src/components/chat/ChatMessageItem.tsx',
    'electron/core/infrastructure/http/ollamaHttpClient.ts',
  ]) {
    report.sourceSha256[source] = createHash('sha256').update(fs.readFileSync(source)).digest('hex')
  }
  console.log(`Evidence: ${evidence}`)
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
      clearDocumentMarkdownCache()
      fixture.language = item.language
      fixture.document = {
        id: item.id,
        filename: `${item.id}.md`,
        fileType: 'text',
        numPages: 1,
        ingestedAt: '2026-10-02',
        extractedMarkdown: item.text,
        filePath: `${item.id}.md`,
        fileSize: Buffer.byteLength(item.text),
        numChunks: 1,
        status: 'indexed',
      }
      let captured: OllamaStreamRequest | undefined
      let answer = ''
      const api: Pick<NonNullable<Window['electronAPI']>, 'getIngestedDocuments' | 'getIngestedDocument' | 'searchVectorDb' | 'generateOllamaStream'> = {
        getIngestedDocuments: async () => [fixture.document!],
        getIngestedDocument: async () => fixture.document,
        searchVectorDb: async () => [{ chunk_id: `${item.id}_0`, doc_id: item.id, doc_name: `${item.id}.md`, text: item.text, score: item.score }],
        generateOllamaStream: async (request, onChunk, onDone) => {
          captured = request
          return client.generateStream(
            request.model,
            request.prompt,
            (text) => {
              answer += text
              onChunk(text)
            },
            onDone || (() => {}),
            request.options,
            host,
            request.operationId,
          )
        },
      }
      Object.assign(window, { electronAPI: api })
      const root = createRoot(document.createElement('div'))
      const started = Date.now()
      try {
        await act(async () => root.render(createElement(I18nProvider, { initialLanguage: item.language, children: createElement(Harness) })))
        await act(async () => {
          chat.toggleDocSelection(item.id)
          chat.setInput(item.query)
        })
        await act(async () => chat.handleSendMessage())
        report.cases.push({ ...item, request: captured, answer, elapsedMs: Date.now() - started, visibleAnswer: chat.messages.at(-1)?.text })
        fs.writeFileSync(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8')
        expect(captured?.model).toBe(model)
        expect(captured?.prompt).toContain('If the supplied text does not support the answer, say so.')
        expect(answer.trim()).not.toBe('')
        expect(chat.messages.at(-1)?.text).toBe(answer)
        console.log(`${item.id}: ${Date.now() - started} ms; ${answer}`)
      } finally {
        await act(async () => root.unmount())
      }
    }
    const after = await installedModels()
    expect(after.models.find((item) => item.name === model)?.digest).toBe(provenance?.digest)
  } finally {
    fs.writeFileSync(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8')
    localStorage.clear()
    fixture.document = null
    window.electronAPI = undefined
  }
})
