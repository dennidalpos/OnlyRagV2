import { describe, it, expect, afterEach } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { AgentStreamTransport, type AgentChatMessage } from './agentStreamTransport'
import { OLLAMA_TOOL_SCHEMA_CATALOG } from '../../domain/agent/ollamaToolSchemaCatalog'
import type { OllamaRuntimeOptions } from '../../domain/agent/hardwareProfileResolver'

/** The request body the mock Ollama server received. */
interface CapturedOllamaBody {
  tools?: unknown[]
  messages: unknown
  stream: boolean
  think?: unknown
  options: { num_predict?: number; stop?: string[]; num_ctx?: number }
}

const runtimeOpts: OllamaRuntimeOptions = {
  num_ctx: 8192,
  num_predict: 6144,
  maxContextChars: 28000,
}

const userMessage = (content: string): AgentChatMessage[] => [{ role: 'user', content }]

function startMockOllama(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<{ server: http.Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` })
    })
  })
}

/** A mock Ollama that records the request path and body, then streams the given NDJSON records. */
function recordingOllama(records: readonly unknown[], seen: { path?: string; body?: CapturedOllamaBody }) {
  return startMockOllama((req, res) => {
    let raw = ''
    req.on('data', (chunk) => (raw += chunk))
    req.on('end', () => {
      seen.path = req.url
      seen.body = JSON.parse(raw)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      for (const record of records) res.write(`${JSON.stringify(record)}\n`)
      res.end()
    })
  })
}

describe('AgentStreamTransport', () => {
  let activeServer: http.Server | null = null

  afterEach(() => {
    if (activeServer) {
      activeServer.close()
      activeServer = null
    }
  })

  it('does not enqueue a model request after the run signal is aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      AgentStreamTransport.streamCompletion({
        targetModel: 'qwen2.5-coder:7b',
        messages: userMessage('Do not send this request'),
        toolCatalog: OLLAMA_TOOL_SCHEMA_CATALOG,
        runtimeOpts,
        isCancelled: () => false,
        signal: controller.signal,
      }),
    ).rejects.toThrow('Agent run cancelled')
  })

  it('streams POST /api/chat with the transcript and the tools array, and returns the structured call', async () => {
    const seen: { path?: string; body?: CapturedOllamaBody } = {}
    const mock = await recordingOllama(
      [
        { message: { role: 'assistant', content: '' }, done: false },
        { message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'read_file', arguments: { filePath: 'app.py' } } }] }, done: true },
      ],
      seen,
    )
    activeServer = mock.server

    const turn = await AgentStreamTransport.streamCompletion({
      targetModel: 'llama3.1:8b',
      messages: userMessage('Read app.py'),
      toolCatalog: OLLAMA_TOOL_SCHEMA_CATALOG,
      runtimeOpts,
      ollamaEndpoint: mock.baseUrl,
      isCancelled: () => false,
    })

    expect(seen.path).toBe('/api/chat')
    expect(seen.body?.tools?.length).toBe(OLLAMA_TOOL_SCHEMA_CATALOG.length)
    expect(seen.body?.messages).toEqual([{ role: 'user', content: 'Read app.py' }])
    expect(seen.body?.stream).toBe(true)
    expect(turn.toolCalls).toEqual([{ type: 'function', function: { index: 0, name: 'read_file', arguments: { filePath: 'app.py' } } }])
  })

  it('sends no tools field when the turn offers no tools', async () => {
    const seen: { path?: string; body?: CapturedOllamaBody } = {}
    const mock = await recordingOllama([{ message: { role: 'assistant', content: 'OK' }, done: true }], seen)
    activeServer = mock.server

    const turn = await AgentStreamTransport.streamCompletion({
      targetModel: 'gpt-oss:20b',
      messages: userMessage('Reply OK'),
      toolCatalog: [],
      runtimeOpts,
      ollamaEndpoint: mock.baseUrl,
      isCancelled: () => false,
    })

    expect(seen.path).toBe('/api/chat')
    expect(seen.body).not.toHaveProperty('tools')
    expect(turn).toEqual({ content: 'OK', thinking: '', toolCalls: [] })
  })

  it('returns every native call and sends the supplied assistant/tool transcript back to Ollama', async () => {
    const seen: { path?: string; body?: CapturedOllamaBody } = {}
    const mock = await recordingOllama(
      [
        { message: { thinking: 'inspect', content: '' }, done: false },
        {
          message: {
            content: 'Reading both files',
            tool_calls: [
              { function: { index: 0, name: 'read_file', arguments: { filePath: 'a.ts' } } },
              { function: { index: 1, name: 'read_file', arguments: { filePath: 'b.ts' } } },
            ],
          },
          done: true,
        },
      ],
      seen,
    )
    activeServer = mock.server
    const messages: AgentChatMessage[] = [
      { role: 'system', content: 'Inspect the project' },
      { role: 'user', content: 'Read both files' },
      { role: 'assistant', content: '', tool_calls: [{ type: 'function', function: { index: 0, name: 'list_dir', arguments: {} } }] },
      { role: 'tool', tool_name: 'list_dir', content: 'a.ts, b.ts' },
    ]
    const turn = await AgentStreamTransport.streamCompletion({
      targetModel: 'qwen3.8:27b',
      messages,
      toolCatalog: OLLAMA_TOOL_SCHEMA_CATALOG,
      runtimeOpts,
      ollamaEndpoint: mock.baseUrl,
      isCancelled: () => false,
    })
    expect(seen.body?.messages).toEqual(messages)
    expect(turn).toEqual({
      content: 'Reading both files',
      thinking: 'inspect',
      toolCalls: [
        { type: 'function', function: { index: 0, name: 'read_file', arguments: { filePath: 'a.ts' } } },
        { type: 'function', function: { index: 1, name: 'read_file', arguments: { filePath: 'b.ts' } } },
      ],
    })
  })

  it('keeps separate calls streamed in separate chunks without function indexes', async () => {
    const mock = await recordingOllama(
      [
        { message: { tool_calls: [{ function: { name: 'read_file', arguments: { filePath: 'a.ts' } } }] }, done: false },
        { message: { tool_calls: [{ function: { name: 'read_file', arguments: { filePath: 'b.ts' } } }] }, done: true },
      ],
      {},
    )
    activeServer = mock.server
    const turn = await AgentStreamTransport.streamCompletion({
      targetModel: 'qwen3.8:27b',
      messages: userMessage('Read both files'),
      toolCatalog: OLLAMA_TOOL_SCHEMA_CATALOG,
      runtimeOpts,
      ollamaEndpoint: mock.baseUrl,
      isCancelled: () => false,
    })
    expect(turn.toolCalls.map((call) => call.function.arguments.filePath)).toEqual(['a.ts', 'b.ts'])
  })

  it('returns JSON the model wrote as prose as content, with no tool call', async () => {
    const mock = await recordingOllama(
      [
        { message: { role: 'assistant', content: '{"name": "read_file", ' }, done: false },
        { message: { role: 'assistant', content: '"arguments": {"filePath": "app.py"}}' }, done: true },
      ],
      {},
    )
    activeServer = mock.server

    const turn = await AgentStreamTransport.streamCompletion({
      targetModel: 'qwen2.5-coder:7b',
      messages: userMessage('Read app.py'),
      toolCatalog: OLLAMA_TOOL_SCHEMA_CATALOG,
      runtimeOpts,
      ollamaEndpoint: mock.baseUrl,
      isCancelled: () => false,
    })

    expect(turn.content).toBe('{"name": "read_file", "arguments": {"filePath": "app.py"}}')
    expect(turn.toolCalls).toEqual([])
  })

  it('invokes onTokenChunk live for each content delta', async () => {
    const mock = await recordingOllama(
      [
        { message: { role: 'assistant', content: 'Hello' }, done: false },
        { message: { role: 'assistant', content: ' world' }, done: false },
        { message: { role: 'assistant', content: '' }, done: true },
      ],
      {},
    )
    activeServer = mock.server

    const chunks: string[] = []
    const turn = await AgentStreamTransport.streamCompletion({
      targetModel: 'llama3.1:8b',
      messages: userMessage('Say hello'),
      toolCatalog: OLLAMA_TOOL_SCHEMA_CATALOG,
      runtimeOpts,
      ollamaEndpoint: mock.baseUrl,
      isCancelled: () => false,
      onTokenChunk: (chunk) => chunks.push(chunk),
    })

    expect(chunks).toEqual(['Hello', ' world'])
    expect(turn.content).toBe('Hello world')
  })

  it('reports Ollama timing and token counters from the final stream record', async () => {
    const mock = await recordingOllama(
      [{ message: { role: 'assistant', content: 'done' }, done: true, total_duration: 8_000_000, prompt_eval_count: 12, eval_count: 3 }],
      {},
    )
    activeServer = mock.server
    const received: Array<{ totalDurationMs?: number; promptTokens?: number; completionTokens?: number }> = []

    await AgentStreamTransport.streamCompletion({
      targetModel: 'qwen2.5-coder:7b',
      messages: userMessage('Work'),
      toolCatalog: OLLAMA_TOOL_SCHEMA_CATALOG,
      runtimeOpts,
      ollamaEndpoint: mock.baseUrl,
      isCancelled: () => false,
      onGenerationTelemetry: (telemetry) => received.push(telemetry),
    })

    expect(received).toMatchObject([{ totalDurationMs: 8, promptTokens: 12, completionTokens: 3 }])
  })

  it('rejects with a pull-model message on 404', async () => {
    const mock = await startMockOllama((_req, res) => {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'model not found' }))
    })
    activeServer = mock.server

    await expect(
      AgentStreamTransport.streamCompletion({
        targetModel: 'llama3.1:8b',
        messages: userMessage('Read app.py'),
        toolCatalog: OLLAMA_TOOL_SCHEMA_CATALOG,
        runtimeOpts,
        ollamaEndpoint: mock.baseUrl,
        isCancelled: () => false,
      }),
    ).rejects.toThrow(/not pulled/)
  })

  it('rejects a native tool call when the stream never reaches done', async () => {
    const mock = await recordingOllama(
      [{ message: { tool_calls: [{ function: { name: 'read_file', arguments: { filePath: 'partial.ts' } } }] }, done: false }],
      {},
    )
    activeServer = mock.server

    await expect(
      AgentStreamTransport.streamCompletion({
        targetModel: 'qwen2.5-coder:7b',
        messages: userMessage('Read partial.ts'),
        toolCatalog: OLLAMA_TOOL_SCHEMA_CATALOG,
        runtimeOpts,
        ollamaEndpoint: mock.baseUrl,
        isCancelled: () => false,
      }),
    ).rejects.toThrow(/incomplete/)
  })

  it('rejects a response truncated by num_predict', async () => {
    const mock = await recordingOllama([{ message: { role: 'assistant', content: 'partial' }, done: true, done_reason: 'length' }], {})
    activeServer = mock.server

    await expect(
      AgentStreamTransport.streamCompletion({
        targetModel: 'qwen2.5-coder:7b',
        messages: userMessage('Write a file'),
        toolCatalog: OLLAMA_TOOL_SCHEMA_CATALOG,
        runtimeOpts,
        ollamaEndpoint: mock.baseUrl,
        isCancelled: () => false,
      }),
    ).rejects.toThrow(/incomplete \(length\)/)
  })

  it('sends only num_ctx, num_predict and user sampling overrides, and think only when set', async () => {
    const seen: { path?: string; body?: CapturedOllamaBody } = {}
    const mock = await recordingOllama([{ message: { role: 'assistant', content: 'ok' }, done: true }], seen)
    activeServer = mock.server

    await AgentStreamTransport.streamCompletion({
      targetModel: 'llama3.1:8b',
      messages: userMessage('Read app.py'),
      toolCatalog: OLLAMA_TOOL_SCHEMA_CATALOG,
      runtimeOpts,
      ollamaEndpoint: mock.baseUrl,
      isCancelled: () => false,
    })

    expect(seen.body?.options).toEqual({ num_ctx: 8192, num_predict: 6144 })
    expect(seen.body).not.toHaveProperty('think')

    await AgentStreamTransport.streamCompletion({
      targetModel: 'qwen3.8:27b',
      messages: userMessage('Read app.py'),
      toolCatalog: OLLAMA_TOOL_SCHEMA_CATALOG,
      runtimeOpts: { ...runtimeOpts, temperature: 0.6, top_k: 20 },
      ollamaEndpoint: mock.baseUrl,
      isCancelled: () => false,
      think: 'low',
    })

    expect(seen.body?.options).toEqual({ num_ctx: 8192, num_predict: 6144, temperature: 0.6, top_k: 20 })
    expect(seen.body?.think).toBe('low')
  })

  it('streams thinking deltas via onThoughtChunk and keeps them out of the content', async () => {
    const seen: { path?: string; body?: CapturedOllamaBody } = {}
    const mock = await recordingOllama(
      [
        { message: { role: 'assistant', thinking: 'Evaluating tool... ' }, done: false },
        { message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'read_file', arguments: { filePath: 'index.ts' } } }] }, done: true },
      ],
      seen,
    )
    activeServer = mock.server

    const thoughts: string[] = []
    const turn = await AgentStreamTransport.streamCompletion({
      targetModel: 'qwen3:8b',
      messages: userMessage('Read index.ts'),
      toolCatalog: OLLAMA_TOOL_SCHEMA_CATALOG,
      runtimeOpts,
      ollamaEndpoint: mock.baseUrl,
      isCancelled: () => false,
      onThoughtChunk: (thought) => thoughts.push(thought),
      think: true,
    })

    expect(thoughts).toEqual(['Evaluating tool... '])
    expect(turn).toMatchObject({ content: '', thinking: 'Evaluating tool... ' })
    expect(turn.toolCalls[0].function).toMatchObject({ name: 'read_file', arguments: { filePath: 'index.ts' } })
    expect(seen.body?.think).toBe(true)
  })
})
