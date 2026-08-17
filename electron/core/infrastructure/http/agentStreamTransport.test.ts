import { describe, it, expect, afterEach } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { AgentStreamTransport } from './agentStreamTransport'
import { parseAgentToolCall } from '../../domain/agent/toolParser'
import { OLLAMA_TOOL_SCHEMA_CATALOG } from '../../domain/agent/ollamaToolSchemaCatalog'
import type { OllamaRuntimeOptions } from '../../domain/agent/hardwareProfileResolver'

const runtimeOpts: OllamaRuntimeOptions = { num_ctx: 8192, temperature: 0.1, top_p: 0.9, repeat_penalty: 1.1, maxContextChars: 28000 }

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

  it('should route to /api/chat with a tools array when toolCallingCapable + toolCatalog are set, and serialize a populated tool_calls response into the {"name","arguments"} shape toolParser.ts understands', async () => {
    let capturedBody: any = null
    const mock = await startMockOllama((req, res) => {
      let raw = ''
      req.on('data', (c) => (raw += c))
      req.on('end', () => {
        capturedBody = JSON.parse(raw)
        expect(req.url).toBe('/api/chat')
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{ function: { name: 'read_file', arguments: { filePath: 'app.py' } } }],
          },
          done: true,
        }))
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
    })

    expect(capturedBody.tools).toBeDefined()
    expect(capturedBody.tools.length).toBeGreaterThan(0)
    expect(capturedBody.messages).toEqual([{ role: 'user', content: 'Read app.py' }])
    expect(capturedBody.stream).toBe(false)

    // Downstream contract check: the existing toolParser.ts must correctly parse this output.
    const parsedCall = parseAgentToolCall(output)
    expect(parsedCall).not.toBeNull()
    expect(parsedCall?.tool).toBe('read_file')
    expect(parsedCall?.parameters.filePath).toBe('app.py')
  })

  it('should fall back to the raw text content when tool_calls is empty (e.g. a "tools"-capable model that echoes the call as JSON text instead)', async () => {
    const mock = await startMockOllama((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        message: { role: 'assistant', content: '{"name": "read_file", "arguments": {"filePath": "app.py"}}' },
        done: true,
      }))
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
    })

    expect(output).toContain('read_file')
    const parsedCall = parseAgentToolCall(output)
    expect(parsedCall?.tool).toBe('read_file')
    expect(parsedCall?.parameters.filePath).toBe('app.py')
  })

  it('should NOT route to /api/chat when toolCallingCapable is false — existing /api/generate behavior is preserved unchanged', async () => {
    let hitPath = ''
    const mock = await startMockOllama((req, res) => {
      hitPath = req.url || ''
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.write(JSON.stringify({ response: 'plain completion text' }) + '\n')
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

  it('should NOT route to /api/chat when toolCatalog is empty even if toolCallingCapable is true', async () => {
    let hitPath = ''
    const mock = await startMockOllama((req, res) => {
      hitPath = req.url || ''
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.write(JSON.stringify({ response: 'plain completion text' }) + '\n')
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
      })
    ).rejects.toThrow(/not pulled/)
  })
})
