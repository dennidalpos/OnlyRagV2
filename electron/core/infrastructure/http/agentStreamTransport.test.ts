import { describe, it, expect, afterEach } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { AgentStreamTransport } from './agentStreamTransport'
import { parseAgentToolCall } from '../../domain/agent/toolParser'
import { OLLAMA_TOOL_SCHEMA_CATALOG } from '../../domain/agent/ollamaToolSchemaCatalog'
import { AGENT_STOP_SEQUENCES, type OllamaRuntimeOptions } from '../../domain/agent/hardwareProfileResolver'

/** The request body the mock Ollama server received. */
interface CapturedOllamaBody {
  tools: unknown[]
  messages: unknown
  stream: boolean
  context?: number[]
  prompt: string
  options: { num_predict?: number; stop?: string[]; num_ctx?: number }
}

const runtimeOpts: OllamaRuntimeOptions = {
  num_ctx: 8192,
  temperature: 0.1,
  top_p: 0.9,
  repeat_penalty: 1.1,
  num_predict: 6144,
  stop: AGENT_STOP_SEQUENCES,
  maxContextChars: 28000,
}

function startMockOllama(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<{ server: http.Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` })
    })
  })
}

describe('AgentStreamTransport — native tool-calling routing', () => {
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
        prompt: 'Do not send this request',
        runtimeOpts,
        isCancelled: () => false,
        signal: controller.signal,
      }),
    ).rejects.toThrow('Agent run cancelled')
  })

  it('should route to /api/chat streamed (stream:true) with a tools array when toolCallingCapable + toolCatalog are set, and serialize a populated tool_calls response into the {"name","arguments"} shape toolParser.ts understands (AGT7: incremental streaming, tool_calls arrives on the final NDJSON line)', async () => {
    let capturedBody = {} as CapturedOllamaBody
    const observed: string[] = []
    const mock = await startMockOllama((req, res) => {
      let raw = ''
      req.on('data', (c) => (raw += c))
      req.on('end', () => {
        capturedBody = JSON.parse(raw)
        expect(req.url).toBe('/api/chat')
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.write(JSON.stringify({ message: { role: 'assistant', content: '' }, done: false }) + '\n')
        res.write(
          JSON.stringify({
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [{ function: { name: 'read_file', arguments: { filePath: 'app.py' } } }],
            },
            done: true,
          }) + '\n',
        )
        res.end()
      })
    })
    activeServer = mock.server

    const output = await AgentStreamTransport.streamCompletion({
      targetModel: 'llama3.1:8b',
      prompt: 'Read app.py',
      runtimeOpts,
      ollamaEndpoint: mock.baseUrl,
      isCancelled: () => false,
      toolCallingCapable: true,
      toolCatalog: OLLAMA_TOOL_SCHEMA_CATALOG,
      onToolProtocolObserved: (protocol) => observed.push(protocol),
    })

    expect(capturedBody.tools).toBeDefined()
    expect(capturedBody.tools.length).toBeGreaterThan(0)
    expect(capturedBody.messages).toEqual([{ role: 'user', content: 'Read app.py' }])
    expect(capturedBody.stream).toBe(true)

    // Downstream contract check: the existing toolParser.ts must correctly parse this output.
    const parsedCall = parseAgentToolCall(output)
    expect(parsedCall).not.toBeNull()
    expect(parsedCall?.tool).toBe('read_file')
    expect(parsedCall?.parameters.filePath).toBe('app.py')
    expect(observed).toEqual(['native'])
  })

  it('returns every native call and sends the supplied assistant/tool transcript back to Ollama', async () => {
    let capturedBody = {} as CapturedOllamaBody
    const mock = await startMockOllama((req, res) => {
      let raw = ''
      req.on('data', (chunk) => (raw += chunk))
      req.on('end', () => {
        capturedBody = JSON.parse(raw)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.write(JSON.stringify({ message: { thinking: 'inspect', content: '' }, done: false }) + '\n')
        res.write(
          JSON.stringify({
            message: {
              content: 'Reading both files',
              tool_calls: [
                { function: { index: 0, name: 'read_file', arguments: { filePath: 'a.ts' } } },
                { function: { index: 1, name: 'read_file', arguments: { filePath: 'b.ts' } } },
              ],
            },
            done: true,
          }) + '\n',
        )
        res.end()
      })
    })
    activeServer = mock.server
    const messages = [
      { role: 'system' as const, content: 'Inspect the project' },
      { role: 'user' as const, content: 'Read both files' },
      { role: 'assistant' as const, content: '', tool_calls: [{ type: 'function' as const, function: { index: 0, name: 'list_dir', arguments: {} } }] },
      { role: 'tool' as const, tool_name: 'list_dir', content: 'a.ts, b.ts' },
    ]
    const output = await AgentStreamTransport.streamCompletion({
      targetModel: 'qwen3.8:27b',
      prompt: 'unused when messages are supplied',
      messages,
      runtimeOpts,
      ollamaEndpoint: mock.baseUrl,
      isCancelled: () => false,
      toolCallingCapable: true,
      toolCatalog: OLLAMA_TOOL_SCHEMA_CATALOG,
    })
    expect(capturedBody.messages).toEqual(messages)
    expect(output).toEqual({
      content: 'Reading both files',
      thinking: 'inspect',
      toolCalls: [
        { type: 'function', function: { index: 0, name: 'read_file', arguments: { filePath: 'a.ts' } } },
        { type: 'function', function: { index: 1, name: 'read_file', arguments: { filePath: 'b.ts' } } },
      ],
    })
  })

  it('keeps separate calls streamed in separate chunks without function indexes', async () => {
    const mock = await startMockOllama((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.write(JSON.stringify({ message: { tool_calls: [{ function: { name: 'read_file', arguments: { filePath: 'a.ts' } } }] }, done: false }) + '\n')
      res.write(JSON.stringify({ message: { tool_calls: [{ function: { name: 'read_file', arguments: { filePath: 'b.ts' } } }] }, done: true }) + '\n')
      res.end()
    })
    activeServer = mock.server
    const output = await AgentStreamTransport.streamCompletion({
      targetModel: 'qwen3.8:27b',
      prompt: '',
      messages: [{ role: 'user', content: 'Read both files' }],
      runtimeOpts,
      ollamaEndpoint: mock.baseUrl,
      isCancelled: () => false,
      toolCallingCapable: true,
      toolCatalog: OLLAMA_TOOL_SCHEMA_CATALOG,
    })
    expect(output.toolCalls.map((call) => call.function.arguments.filePath)).toEqual(['a.ts', 'b.ts'])
  })

  it('should fall back to the accumulated raw text content when tool_calls is empty (e.g. a "tools"-capable model that echoes the call as JSON text instead), streamed across multiple content deltas', async () => {
    const observed: string[] = []
    const mock = await startMockOllama((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.write(JSON.stringify({ message: { role: 'assistant', content: '{"name": "read_file", ' }, done: false }) + '\n')
      res.write(JSON.stringify({ message: { role: 'assistant', content: '"arguments": {"filePath": "app.py"}}' }, done: true }) + '\n')
      res.end()
    })
    activeServer = mock.server

    const output = await AgentStreamTransport.streamCompletion({
      targetModel: 'qwen2.5-coder:7b',
      prompt: 'Read app.py',
      runtimeOpts,
      ollamaEndpoint: mock.baseUrl,
      isCancelled: () => false,
      toolCallingCapable: true,
      toolCatalog: OLLAMA_TOOL_SCHEMA_CATALOG,
      onToolProtocolObserved: (protocol) => observed.push(protocol),
    })

    expect(output).toContain('read_file')
    const parsedCall = parseAgentToolCall(output)
    expect(parsedCall?.tool).toBe('read_file')
    expect(parsedCall?.parameters.filePath).toBe('app.py')
    expect(observed).toEqual(['text'])
  })

  it('should invoke onTokenChunk live for each content delta on the native tool-calling path (AGT7: the UI previously received no feedback until the whole response landed)', async () => {
    const mock = await startMockOllama((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.write(JSON.stringify({ message: { role: 'assistant', content: 'Hello' }, done: false }) + '\n')
      res.write(JSON.stringify({ message: { role: 'assistant', content: ' world' }, done: false }) + '\n')
      res.write(JSON.stringify({ message: { role: 'assistant', content: '' }, done: true }) + '\n')
      res.end()
    })
    activeServer = mock.server

    const chunks: string[] = []
    const output = await AgentStreamTransport.streamCompletion({
      targetModel: 'llama3.1:8b',
      prompt: 'Say hello',
      runtimeOpts,
      ollamaEndpoint: mock.baseUrl,
      isCancelled: () => false,
      toolCallingCapable: true,
      toolCatalog: OLLAMA_TOOL_SCHEMA_CATALOG,
      onTokenChunk: (chunk) => chunks.push(chunk),
    })

    expect(chunks).toEqual(['Hello', ' world'])
    expect(output).toBe('Hello world')
  })

  it('should NOT route to /api/chat when toolCallingCapable is false — existing /api/generate behavior is preserved unchanged', async () => {
    let hitPath = ''
    const mock = await startMockOllama((req, res) => {
      hitPath = req.url || ''
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.write(JSON.stringify({ response: 'plain completion text', done: true }) + '\n')
      res.end()
    })
    activeServer = mock.server

    const output = await AgentStreamTransport.streamCompletion({
      targetModel: 'deepseek-r1:8b',
      prompt: 'Explain this file',
      runtimeOpts,
      ollamaEndpoint: mock.baseUrl,
      isCancelled: () => false,
      toolCallingCapable: false,
    })

    expect(hitPath).toBe('/api/generate')
    expect(output).toBe('plain completion text')
  })

  it('reports Ollama timing and token counters from the final stream record', async () => {
    const mock = await startMockOllama((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ response: 'done', done: true, total_duration: 8_000_000, prompt_eval_count: 12, eval_count: 3 }) + '\n')
    })
    activeServer = mock.server
    const received: Array<{ totalDurationMs?: number; promptTokens?: number; completionTokens?: number }> = []

    await AgentStreamTransport.streamCompletion({
      targetModel: 'qwen2.5-coder:7b',
      prompt: 'Work',
      runtimeOpts,
      ollamaEndpoint: mock.baseUrl,
      isCancelled: () => false,
      onGenerationTelemetry: (telemetry) => received.push(telemetry),
    })

    expect(received).toMatchObject([{ totalDurationMs: 8, promptTokens: 12, completionTokens: 3 }])
  })

  it('should NOT route to /api/chat when toolCatalog is empty even if toolCallingCapable is true', async () => {
    let hitPath = ''
    const mock = await startMockOllama((req, res) => {
      hitPath = req.url || ''
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.write(JSON.stringify({ response: 'plain completion text', done: true }) + '\n')
      res.end()
    })
    activeServer = mock.server

    await AgentStreamTransport.streamCompletion({
      targetModel: 'llama3.1:8b',
      prompt: 'Explain this file',
      runtimeOpts,
      ollamaEndpoint: mock.baseUrl,
      isCancelled: () => false,
      toolCallingCapable: true,
      toolCatalog: [],
    })

    expect(hitPath).toBe('/api/generate')
  })

  it('should reject with a pull-model message on 404 from /api/chat', async () => {
    const mock = await startMockOllama((_req, res) => {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'model not found' }))
    })
    activeServer = mock.server

    await expect(
      AgentStreamTransport.streamCompletion({
        targetModel: 'llama3.1:8b',
        prompt: 'Read app.py',
        runtimeOpts,
        ollamaEndpoint: mock.baseUrl,
        isCancelled: () => false,
        toolCallingCapable: true,
        toolCatalog: OLLAMA_TOOL_SCHEMA_CATALOG,
      }),
    ).rejects.toThrow(/not pulled/)
  })

  it('rejects a native tool call when the stream never reaches done', async () => {
    const mock = await startMockOllama((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          message: { tool_calls: [{ function: { name: 'read_file', arguments: { filePath: 'partial.ts' } } }] },
          done: false,
        }) + '\n',
      )
    })
    activeServer = mock.server

    await expect(
      AgentStreamTransport.streamCompletion({
        targetModel: 'qwen2.5-coder:7b',
        prompt: 'Read partial.ts',
        runtimeOpts,
        ollamaEndpoint: mock.baseUrl,
        isCancelled: () => false,
        toolCallingCapable: true,
        toolCatalog: OLLAMA_TOOL_SCHEMA_CATALOG,
      }),
    ).rejects.toThrow(/incomplete/)
  })
})

describe('AgentStreamTransport — /api/generate context continuation (AGT1: Ollama context/KV-cache reuse)', () => {
  let activeServer: http.Server | null = null

  afterEach(() => {
    if (activeServer) {
      activeServer.close()
      activeServer = null
    }
  })

  it('should include the `context` field in the request body when previousContext is provided', async () => {
    let capturedBody = {} as CapturedOllamaBody
    const mock = await startMockOllama((req, res) => {
      let raw = ''
      req.on('data', (c) => (raw += c))
      req.on('end', () => {
        capturedBody = JSON.parse(raw)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.write(JSON.stringify({ response: 'ok', done: true }) + '\n')
        res.end()
      })
    })
    activeServer = mock.server

    await AgentStreamTransport.streamCompletion({
      targetModel: 'qwen2.5-coder:7b',
      prompt: 'incremental delta only',
      runtimeOpts,
      ollamaEndpoint: mock.baseUrl,
      isCancelled: () => false,
      previousContext: [10, 20, 30],
    })

    expect(capturedBody.context).toEqual([10, 20, 30])
    expect(capturedBody.prompt).toBe('incremental delta only')
  })

  it('should NOT include a `context` field when previousContext is absent (default/first-turn behavior unchanged)', async () => {
    let capturedBody = {} as CapturedOllamaBody
    const mock = await startMockOllama((req, res) => {
      let raw = ''
      req.on('data', (c) => (raw += c))
      req.on('end', () => {
        capturedBody = JSON.parse(raw)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.write(JSON.stringify({ response: 'ok', done: true }) + '\n')
        res.end()
      })
    })
    activeServer = mock.server

    await AgentStreamTransport.streamCompletion({
      targetModel: 'qwen2.5-coder:7b',
      prompt: 'full prompt',
      runtimeOpts,
      ollamaEndpoint: mock.baseUrl,
      isCancelled: () => false,
    })

    expect(capturedBody.context).toBeUndefined()
  })

  it('should invoke onContextReceived with the returned context array and the responding model when the stream completes (done:true)', async () => {
    const mock = await startMockOllama((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.write(JSON.stringify({ response: 'Hello' }) + '\n')
      res.write(JSON.stringify({ response: ' world', done: true, context: [1, 2, 3] }) + '\n')
      res.end()
    })
    activeServer = mock.server

    let received: { context: number[]; model: string } | null = null
    const output = await AgentStreamTransport.streamCompletion({
      targetModel: 'qwen2.5-coder:7b',
      prompt: 'full prompt',
      runtimeOpts,
      ollamaEndpoint: mock.baseUrl,
      isCancelled: () => false,
      onContextReceived: (context, respondingModel) => {
        received = { context, model: respondingModel }
      },
    })

    expect(output).toBe('Hello world')
    expect(received).toEqual({ context: [1, 2, 3], model: 'qwen2.5-coder:7b' })
  })

  it('should not invoke onContextReceived when the response never includes a `context` field', async () => {
    const mock = await startMockOllama((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.write(JSON.stringify({ response: 'plain text', done: true }) + '\n')
      res.end()
    })
    activeServer = mock.server

    let calledCount = 0
    await AgentStreamTransport.streamCompletion({
      targetModel: 'qwen2.5-coder:7b',
      prompt: 'full prompt',
      runtimeOpts,
      ollamaEndpoint: mock.baseUrl,
      isCancelled: () => false,
      onContextReceived: () => {
        calledCount++
      },
    })

    expect(calledCount).toBe(0)
  })

  it('should forward num_predict and the stop sequences to Ollama on the /api/generate path, so a small model cannot ramble past its tool call', async () => {
    let capturedBody = {} as CapturedOllamaBody
    const mock = await startMockOllama((req, res) => {
      let raw = ''
      req.on('data', (c) => (raw += c))
      req.on('end', () => {
        capturedBody = JSON.parse(raw)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.write(JSON.stringify({ response: 'ok', done: true }) + '\n')
        res.end()
      })
    })
    activeServer = mock.server

    await AgentStreamTransport.streamCompletion({
      targetModel: 'qwen2.5-coder:7b',
      prompt: 'full prompt',
      runtimeOpts,
      ollamaEndpoint: mock.baseUrl,
      isCancelled: () => false,
    })

    expect(capturedBody.options.num_predict).toBe(6144)
    expect(capturedBody.options.stop).toEqual(AGENT_STOP_SEQUENCES)
    expect(capturedBody.options.num_ctx).toBe(8192)
  })

  it('rejects a text tool response truncated by num_predict', async () => {
    const mock = await startMockOllama((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ response: '{"tool":"write_file"', done: true, done_reason: 'length' }) + '\n')
    })
    activeServer = mock.server

    await expect(
      AgentStreamTransport.streamCompletion({
        targetModel: 'qwen2.5-coder:7b',
        prompt: 'Write a file',
        runtimeOpts,
        ollamaEndpoint: mock.baseUrl,
        isCancelled: () => false,
      }),
    ).rejects.toThrow(/incomplete \(length\)/)
  })

  it('should forward num_predict and the stop sequences on the native tool-calling /api/chat path too', async () => {
    let capturedBody = {} as CapturedOllamaBody
    const mock = await startMockOllama((req, res) => {
      let raw = ''
      req.on('data', (c) => (raw += c))
      req.on('end', () => {
        capturedBody = JSON.parse(raw)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.write(JSON.stringify({ message: { role: 'assistant', content: 'ok' }, done: true }) + '\n')
        res.end()
      })
    })
    activeServer = mock.server

    await AgentStreamTransport.streamCompletion({
      targetModel: 'llama3.1:8b',
      prompt: 'Read app.py',
      runtimeOpts,
      ollamaEndpoint: mock.baseUrl,
      isCancelled: () => false,
      toolCallingCapable: true,
      toolCatalog: OLLAMA_TOOL_SCHEMA_CATALOG,
    })

    expect(capturedBody.options.num_predict).toBe(6144)
    expect(capturedBody.options.stop).toEqual(AGENT_STOP_SEQUENCES)
  })

  it('should stream thinking deltas via onThoughtChunk on /api/generate path', async () => {
    let capturedBody: Record<string, unknown> | undefined
    const mock = await startMockOllama((req, res) => {
      let raw = ''
      req.on('data', (chunk) => {
        raw += chunk
      })
      req.on('end', () => {
        capturedBody = JSON.parse(raw)
      })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.write(JSON.stringify({ thinking: 'Analyzing ', response: '', done: false }) + '\n')
      res.write(JSON.stringify({ thinking: 'the request...', response: '', done: false }) + '\n')
      res.write(JSON.stringify({ response: 'Done!', done: true }) + '\n')
      res.end()
    })
    activeServer = mock.server

    const thoughts: string[] = []
    const tokens: string[] = []

    const output = await AgentStreamTransport.streamCompletion({
      targetModel: 'deepseek-r1:8b',
      prompt: 'Refactor code',
      runtimeOpts,
      ollamaEndpoint: mock.baseUrl,
      isCancelled: () => false,
      onThoughtChunk: (thought) => thoughts.push(thought),
      onTokenChunk: (token) => tokens.push(token),
      think: true,
    })

    expect(thoughts).toEqual(['Analyzing ', 'the request...'])
    expect(tokens).toEqual(['Done!'])
    expect(output).toBe('Done!')
    expect(capturedBody?.think).toBe(true)
  })

  it('should stream thinking deltas via onThoughtChunk on /api/chat path', async () => {
    let capturedBody: Record<string, unknown> | undefined
    const mock = await startMockOllama((req, res) => {
      let raw = ''
      req.on('data', (chunk) => {
        raw += chunk
      })
      req.on('end', () => {
        capturedBody = JSON.parse(raw)
      })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.write(JSON.stringify({ message: { role: 'assistant', thinking: 'Evaluating tool... ' }, done: false }) + '\n')
      res.write(
        JSON.stringify({
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{ function: { name: 'read_file', arguments: { filePath: 'index.ts' } } }],
          },
          done: true,
        }) + '\n',
      )
      res.end()
    })
    activeServer = mock.server

    const thoughts: string[] = []

    const output = await AgentStreamTransport.streamCompletion({
      targetModel: 'qwen3:8b',
      prompt: 'Read index.ts',
      runtimeOpts,
      ollamaEndpoint: mock.baseUrl,
      isCancelled: () => false,
      toolCallingCapable: true,
      toolCatalog: OLLAMA_TOOL_SCHEMA_CATALOG,
      onThoughtChunk: (thought) => thoughts.push(thought),
      think: true,
    })

    expect(thoughts).toEqual(['Evaluating tool... '])
    const parsedCall = parseAgentToolCall(output)
    expect(parsedCall?.tool).toBe('read_file')
    expect(parsedCall?.parameters.filePath).toBe('index.ts')
    expect(capturedBody?.think).toBe(true)
  })
})
