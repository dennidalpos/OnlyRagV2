import http from 'node:http'
import https from 'node:https'
import { afterEach, beforeEach, expect, vi } from 'vitest'
import { webClient } from '../../electron/core/infrastructure/http/webClient'
import { skillHubClient } from '../../electron/core/infrastructure/http/skillHubClient'
import { ollamaHttpClient } from '../../electron/core/infrastructure/http/ollamaHttpClient'

/** Concrete hub adapters consume fixtures; any escaped native request fails the test,
 * even when an application catch/fallback swallows the transport exception. */
export function useSkillNetworkFixture() {
  const refused: string[] = []
  const requested: string[] = []
  const unexpected: string[] = []
  beforeEach(() => {
    refused.length = 0
    requested.length = 0
    unexpected.length = 0
    skillHubClient.clearCache()
    for (const transport of [http, https]) {
      for (const method of ['request', 'get'] as const) {
        vi.spyOn(transport, method).mockImplementation((...args: unknown[]) => {
          refused.push(String(args[0]))
          throw new Error('Unexpected native HTTP(S) request in offline skill tests')
        })
      }
    }
    vi.spyOn(ollamaHttpClient, 'getModelMetrics').mockResolvedValue({})
    vi.spyOn(webClient, 'fetchWebContent').mockImplementation(async (url) => {
      requested.push(url)
      if (url === 'https://api.github.com/repos/anthropics/skills/contents/skills') {
        return { success: true, content: JSON.stringify([{ name: 'pdf', type: 'dir' }]) }
      }
      if (url === 'https://chat-plugins.lobehub.com') {
        return {
          success: true,
          content: JSON.stringify({
            plugins: [
              {
                identifier: 'fixture-search',
                meta: {
                  title: 'Fixture search',
                  description: 'Controlled local fixture for search integration',
                  tags: ['fixture-search'],
                },
              },
            ],
          }),
        }
      }
      if (url === 'https://fixture.invalid/native/SKILL.md') {
        return {
          success: true,
          content:
            '---\nname: native-fixture\ndescription: Native "quoted" metadata\nrequired_model: local:3b\ntriggers: [native-fixture]\ntags: [fixture]\n---\n# Native fixture\nUse controlled local documents.\n',
        }
      }
      unexpected.push(url)
      throw new Error(`Missing offline web fixture for ${url}`)
    })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    skillHubClient.clearCache()
    expect(refused, 'requests refused before any forwarding').toEqual([])
    expect(unexpected, 'all web requests must have an explicit local fixture').toEqual([])
  })
  return { refused, requested }
}
