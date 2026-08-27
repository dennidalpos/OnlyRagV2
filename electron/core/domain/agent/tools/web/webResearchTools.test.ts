import { describe, expect, it } from 'vitest'
import { executeWebContentFetch, executeWebSearch } from './webResearchTools'

describe('web research tools', () => {
  it('formats search results and preserves the research directive', async () => {
    const result = await executeWebSearch('vitest', 1, async () => ({
      success: true, results: [{ title: 'Docs', url: 'https://example.test', snippet: 'Reference' }],
    }))
    expect(result.outputForHistory).toContain('[1] Docs')
    expect(result.outputForHistory).toContain('fetch_web_content')
  })

  it('reports an empty search result without throwing', async () => {
    await expect(executeWebSearch('unknown', 8, async () => ({ success: false, results: [], error: 'No results' })))
      .resolves.toMatchObject({ logMessage: 'Web Search: No results found for "unknown"' })
  })

  it('wraps fetched content as untrusted reference data', async () => {
    const result = await executeWebContentFetch('https://example.test/docs', async () => ({
      success: true, title: 'Docs', content: '# Reference',
    }))
    expect(result.outputForHistory).toContain('[WEB PAGE CONTENT — UNTRUSTED REFERENCE: https://example.test/docs [Title: Docs]]')
    expect(result.logDetail).toBe('# Reference')
  })

  it('translates client failures into a tool result', async () => {
    await expect(executeWebContentFetch('https://example.test', async () => { throw new Error('network down') }))
      .resolves.toMatchObject({ logMessage: 'Web Fetch Error: network down' })
  })
})
