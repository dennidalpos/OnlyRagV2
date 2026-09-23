import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ollamaHttpClient } from '../../electron/core/infrastructure/http/ollamaHttpClient'
import { AgentStreamTransport } from '../../electron/core/infrastructure/http/agentStreamTransport'
import { resolveOllamaThinkingPreference } from '../../shared/domain/agent/ollamaThinkingPolicy'
import { ModelThinkingControl } from '../../src/components/settings/ModelThinkingControl'
import { it as italian } from '../../src/i18n/locales/it'
import { loadRealSettings } from './agentLiveHarness'

/**
 * GPT-OSS only exposes thinking levels: Ollama ignores `think: false` and still returns reasoning
 * in a separate `thinking` field. The app must show no off switch for it, send the documented
 * `think: false`, and keep the reasoning out of the model's answer.
 */
const settings = loadRealSettings()
const host = settings.ollamaHost || undefined
const metrics = await ollamaHttpClient.getModelMetrics(host)
const model = Object.keys(metrics).find((name) => name.startsWith('gpt-oss'))

describe.skipIf(!model)('live: GPT-OSS level-only thinking', () => {
  it('is classified level-only from the real inventory, so a stored preference cannot enable think', () => {
    expect(metrics[model!].family).toBe('gptoss')
    expect(metrics[model!].capabilities).toContain('thinking')

    const resolution = resolveOllamaThinkingPreference(model!, { modelThinkingPreferences: { [model!]: true } }, metrics)
    expect(resolution).toMatchObject({ mode: 'level-only', installedModel: model, enabled: false, think: false })
  })

  it('shows only the compatibility note in Settings, with no on/off switch', () => {
    const markup = renderToStaticMarkup(createElement(ModelThinkingControl, { modelName: model!, metrics, settings, onUpdateSettings: () => {} }))

    expect(markup).toContain(italian.settings.thinkingLevelOnlyNote)
    expect(markup).not.toContain('role="switch"')
  })

  it('answers with think:false and routes the reasoning it still produces to the thought channel', async () => {
    const tokens: string[] = []
    const thoughts: string[] = []

    const answer = await AgentStreamTransport.streamCompletion({
      targetModel: model!,
      prompt: 'Reply with exactly the word OK and nothing else.',
      runtimeOpts: { num_ctx: 4096, temperature: 0, top_p: 0.9, repeat_penalty: 1.1, num_predict: 512, stop: [], maxContextChars: 12000 },
      ollamaEndpoint: host,
      think: false,
      isCancelled: () => false,
      onTokenChunk: (chunk) => tokens.push(chunk),
      onThoughtChunk: (chunk) => thoughts.push(chunk),
    })

    console.log(`answer=${JSON.stringify(answer)} thought_chars=${thoughts.join('').length}`)
    expect(answer.trim()).toBe('OK')
    expect(tokens.join('')).toBe(answer)
    // Ollama ignores think:false for GPT-OSS; the reasoning must arrive, but only on the thought channel.
    expect(thoughts.join('').length).toBeGreaterThan(0)
  })
})
