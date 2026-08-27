import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'
import { URL } from 'node:url'
import TurndownService from 'turndown'
import * as cheerio from 'cheerio'
import { logger } from '../../../diagnostics'
import { validatePathSafety } from '../../domain/agent/contextFilter'
import { MAX_DOWNLOAD_BYTES } from '../../domain/agent/ioLimits'
import { httpMetrics } from './httpMetrics'

export interface WebSearchResultItem {
  title: string
  url: string
  snippet: string
}

const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
})
turndownService.remove(['script', 'style', 'noscript', 'nav', 'footer', 'iframe'] as (keyof HTMLElementTagNameMap)[])

export function htmlToCleanMarkdown(html: string): string {
  if (!html || typeof html !== 'string') return ''

  try {
    const $ = cheerio.load(html)
    // 1. Remove non-content elements
    $('script, style, svg, noscript, nav, footer, iframe, header').remove()

    const bodyHtml = $('body').html() || $.html()
    const md = turndownService.turndown(bodyHtml)
    return md.replace(/\n\s*\n\s*\n+/g, '\n\n').trim()
  } catch {
    // Robust fallback
    return html
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .trim()
  }
}

export function parseDuckDuckGoHtmlResults(html: string, maxResults: number = 8): WebSearchResultItem[] {
  const results: WebSearchResultItem[] = []
  if (!html) return results

  try {
    const $ = cheerio.load(html)
    const items = $('.result, .results_links, .web-result')

    if (items.length > 0) {
      items.each((_, el) => {
        if (results.length >= maxResults) return false
        const titleEl = $(el).find('.result__a, .result__title a, a.result__url').first()
        const snippetEl = $(el).find('.result__snippet, .result__snippet-wrapper').first()
        const rawUrl = titleEl.attr('href') || ''
        const rawTitle = titleEl.text().trim()
        const snippet = snippetEl.text().trim()

        let cleanUrl = rawUrl
        try {
          if (rawUrl.includes('uddg=')) {
            const u = new URL(rawUrl.startsWith('http') ? rawUrl : `https:${rawUrl}`)
            const uddg = u.searchParams.get('uddg')
            if (uddg) cleanUrl = decodeURIComponent(uddg)
          }
        } catch {}

        if (rawTitle && cleanUrl) {
          results.push({
            title: rawTitle,
            url: cleanUrl,
            snippet: snippet || rawTitle,
          })
        }
      })
    }

    if (results.length === 0) {
      const snippetMatches = [...html.matchAll(/<a[^>]+class="result__snippet[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
      const titleMatches = [...html.matchAll(/<a[^>]+class="result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]

      for (let i = 0; i < Math.min(titleMatches.length, maxResults); i++) {
        const rawUrl = titleMatches[i][1] || ''
        const rawTitle = $(titleMatches[i][2]).text() || titleMatches[i][2]
        const rawSnippet = snippetMatches[i] ? $(snippetMatches[i][2]).text() : ''

        let cleanUrl = rawUrl
        try {
          if (rawUrl.includes('uddg=')) {
            const u = new URL(rawUrl.startsWith('http') ? rawUrl : `https:${rawUrl}`)
            const uddg = u.searchParams.get('uddg')
            if (uddg) cleanUrl = decodeURIComponent(uddg)
          }
        } catch {}

        const title = rawTitle.trim()
        const snippet = (rawSnippet || rawTitle).trim()

        if (title && cleanUrl) {
          results.push({
            title,
            url: cleanUrl,
            snippet: snippet || title,
          })
        }
      }
    }
  } catch (e) {
    logger.log('WARN', 'WebClient', `Failed parsing DDG html results: ${e}`)
  }

  return results
}

export class WebClient {
  private userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 OnlyRagV2/1.0'

  public validateUrlSafety(urlStr: string): { safeUrl: URL | null; error?: string } {
    if (!urlStr || typeof urlStr !== 'string') {
      return { safeUrl: null, error: 'Empty or invalid URL' }
    }
    try {
      const u = new URL(urlStr)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        return { safeUrl: null, error: `Forbidden protocol '${u.protocol}'. Only HTTP and HTTPS are permitted.` }
      }

      const host = u.hostname.toLowerCase().trim()

      // Block known cloud metadata hostnames & IP
      if (
        host === '169.254.169.254' ||
        host === 'metadata.google.internal' ||
        host === 'metadata.internal' ||
        host === 'instance-data'
      ) {
        return { safeUrl: null, error: 'Access to cloud metadata endpoints is strictly blocked (SSRF Protection).' }
      }

      // Block localhost, IPv6 loopback, and local domain variants
      if (
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '::1' ||
        host === '0.0.0.0' ||
        host.endsWith('.localhost') ||
        host.endsWith('.local')
      ) {
        return { safeUrl: null, error: 'Access to loopback/localhost addresses is forbidden (SSRF Protection).' }
      }

      // Block IPv4 Link-Local (169.254.0.0/16) and RFC1918 Private ranges if raw IP is provided
      const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
      if (ipv4Match) {
        const [, o1, o2] = ipv4Match.map(Number)
        if (
          o1 === 127 || // Loopback
          o1 === 0 ||   // Current network
          o1 === 10 ||  // Class A Private
          (o1 === 172 && o2 >= 16 && o2 <= 31) || // Class B Private
          (o1 === 192 && o2 === 168) ||           // Class C Private
          (o1 === 169 && o2 === 254)              // Link-Local
        ) {
          return { safeUrl: null, error: `Access to private/local network IP range '${host}' is forbidden (SSRF Protection).` }
        }
      }

      return { safeUrl: u }
    } catch (err: any) {
      return { safeUrl: null, error: `Invalid URL: ${err.message}` }
    }
  }

  async searchWeb(query: string, maxResults: number = 8, signal?: AbortSignal): Promise<{ success: boolean; results: WebSearchResultItem[]; error?: string }> {
    if (!query || typeof query !== 'string' || !query.trim()) {
      return { success: false, results: [], error: 'Search query is empty' }
    }
    const cleanQuery = query.trim()
    logger.log('INFO', 'WebClient', `Executing web search for query: "${cleanQuery}"`)

    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(cleanQuery)}`
    const fetchRes = await this.fetchWebContent(searchUrl, 16000, signal)

    if (!fetchRes.success || !fetchRes.content) {
      // Fallback: search via instant API
      return this.searchInstantApi(cleanQuery, signal)
    }

    const results = parseDuckDuckGoHtmlResults(fetchRes.rawHtml || fetchRes.content, maxResults)
    if (results.length === 0) {
      return this.searchInstantApi(cleanQuery)
    }

    return { success: true, results }
  }

  private async searchInstantApi(query: string, signal?: AbortSignal): Promise<{ success: boolean; results: WebSearchResultItem[]; error?: string }> {
    try {
      const apiUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
      const res = await this.fetchWebContent(apiUrl, 16000, signal)
      if (!res.success || !res.content) {
        return { success: false, results: [], error: res.error || 'Web search returned no results' }
      }
      const data = JSON.parse(res.content)
      const results: WebSearchResultItem[] = []

      if (data.AbstractText && data.AbstractURL) {
        results.push({
          title: data.Heading || query,
          url: data.AbstractURL,
          snippet: data.AbstractText,
        })
      }

      if (Array.isArray(data.RelatedTopics)) {
        for (const topic of data.RelatedTopics.slice(0, 6)) {
          if (topic.Text && topic.FirstURL) {
            results.push({
              title: topic.Text.split(' - ')[0] || topic.Text.slice(0, 50),
              url: topic.FirstURL,
              snippet: topic.Text,
            })
          }
        }
      }

      return { success: true, results }
    } catch (err: any) {
      return { success: false, results: [], error: err.message }
    }
  }

  async fetchWebContent(urlStr: string, maxChars: number = 16000, signal?: AbortSignal): Promise<{ success: boolean; content?: string; rawHtml?: string; title?: string; error?: string }> {
    if (signal?.aborted) return { success: false, error: 'Request cancelled by AbortSignal' }
    const urlCheck = this.validateUrlSafety(urlStr)
    if (!urlCheck.safeUrl) {
      return { success: false, error: urlCheck.error }
    }

    const targetUrl = urlCheck.safeUrl
    const isHttps = targetUrl.protocol === 'https:'
    const client = isHttps ? https : http
    const startedAt = Date.now()
    let recorded = false
    const record = (status: number, errorType: Parameters<typeof httpMetrics.record>[2]) => {
      if (recorded) return
      recorded = true
      httpMetrics.record('/web/fetch', status, errorType, Date.now() - startedAt)
    }

    return new Promise((resolve) => {
      const req = client.get(
        targetUrl,
        {
          headers: {
            'User-Agent': this.userAgent,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8',
            'Accept-Language': 'it,en-US;q=0.9,en;q=0.8',
          },
          timeout: 15000,
        },
        (res) => {
          // Follow redirects up to 1 hop
          if (res.statusCode && (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) && res.headers.location) {
            record(res.statusCode, 'none')
            const redirectUrl = new URL(res.headers.location, targetUrl).toString()
            return this.fetchWebContent(redirectUrl, maxChars, signal).then(resolve)
          }

          if (res.statusCode && res.statusCode >= 400) {
            record(res.statusCode, 'http')
            resolve({ success: false, error: `HTTP ${res.statusCode} ${res.statusMessage || ''}` })
            return
          }

          let rawData = ''
          res.setEncoding('utf-8')
          res.on('data', (chunk) => {
            rawData += chunk
            if (rawData.length > 5 * 1024 * 1024) {
              req.destroy()
            }
          })
          res.on('end', () => {
            const cleanText = htmlToCleanMarkdown(rawData)
            const titleMatch = rawData.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
            const title = titleMatch ? htmlToCleanMarkdown(titleMatch[1]) : undefined
            const truncated = cleanText.length > maxChars ? `${cleanText.slice(0, maxChars)}\n... [Content truncated for context budget]` : cleanText

            record(res.statusCode || 0, 'none')
            resolve({
              success: true,
              content: truncated,
              rawHtml: rawData.slice(0, 100000),
              title,
            })
          })
        }
      )

      req.on('error', (err: any) => {
        record(0, 'network')
        logger.log('WARN', 'WebClient', `Network error fetching ${urlStr}: ${err.message}`)
        resolve({ success: false, error: err.message })
      })

      req.on('timeout', () => {
        req.destroy()
        record(0, 'timeout')
        resolve({ success: false, error: `Request timed out (15s limit) for URL ${urlStr}` })
      })

      signal?.addEventListener('abort', () => {
        req.destroy()
        record(0, 'timeout')
        resolve({ success: false, error: 'Request cancelled by AbortSignal' })
      }, { once: true })
    })
  }

  async downloadFile(
    urlStr: string,
    targetFilePath: string,
    workspaceRoot?: string | null,
    signal?: AbortSignal
  ): Promise<{ success: boolean; downloadedBytes?: number; error?: string }> {
    if (signal?.aborted) return { success: false, error: 'Download cancelled by AbortSignal' }
    const urlCheck = this.validateUrlSafety(urlStr)
    if (!urlCheck.safeUrl) {
      return { success: false, error: urlCheck.error }
    }

    const pathCheck = validatePathSafety(targetFilePath, workspaceRoot)
    if (!pathCheck.safePath) {
      return { success: false, error: pathCheck.error }
    }

    const safeDestPath = pathCheck.safePath
    const targetUrl = urlCheck.safeUrl
    const isHttps = targetUrl.protocol === 'https:'
    const client = isHttps ? https : http
    const startedAt = Date.now()
    let recorded = false
    const record = (status: number, errorType: Parameters<typeof httpMetrics.record>[2]) => {
      if (recorded) return
      recorded = true
      httpMetrics.record('/web/download', status, errorType, Date.now() - startedAt)
    }

    return new Promise((resolve) => {
      try {
        fs.mkdirSync(path.dirname(safeDestPath), { recursive: true })
      } catch (dirErr: any) {
        return resolve({ success: false, error: `Failed creating directory: ${dirErr.message}` })
      }

      const fileStream = fs.createWriteStream(safeDestPath)
      let downloadedBytes = 0
      const req = client.get(
        targetUrl,
        {
          headers: {
            'User-Agent': this.userAgent,
          },
          timeout: 60000,
        },
        (res) => {
          if (res.statusCode && (res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
            record(res.statusCode, 'none')
            fileStream.close()
            try { fs.unlinkSync(safeDestPath) } catch {}
            const redirectUrl = new URL(res.headers.location, urlCheck.safeUrl!).toString()
            return this.downloadFile(redirectUrl, targetFilePath, workspaceRoot, signal).then(resolve)
          }

          if (res.statusCode && res.statusCode >= 400) {
            record(res.statusCode, 'http')
            fileStream.close()
            try { fs.unlinkSync(safeDestPath) } catch {}
            return resolve({ success: false, error: `HTTP ${res.statusCode} ${res.statusMessage || ''}` })
          }

          res.on('data', (chunk) => {
            downloadedBytes += chunk.length
            if (downloadedBytes > MAX_DOWNLOAD_BYTES) {
              req.destroy()
              fileStream.close()
              try { fs.unlinkSync(safeDestPath) } catch {}
              record(res.statusCode || 0, 'unknown')
              resolve({ success: false, error: `Download exceeded 100MB safety limit.` })
            }
          })

          res.pipe(fileStream)

          fileStream.on('finish', () => {
            fileStream.close(() => {
              logger.log('INFO', 'WebClient', `Successfully downloaded ${downloadedBytes} bytes to ${safeDestPath}`)
              record(res.statusCode || 0, 'none')
              resolve({ success: true, downloadedBytes })
            })
          })
        }
      )

      req.on('error', (err) => {
        record(0, 'network')
        fileStream.close()
        try { fs.unlinkSync(safeDestPath) } catch {}
        resolve({ success: false, error: err.message })
      })

      req.on('timeout', () => {
        req.destroy()
        record(0, 'timeout')
        fileStream.close()
        try { fs.unlinkSync(safeDestPath) } catch {}
        resolve({ success: false, error: 'Download request timed out (60s limit)' })
      })

      signal?.addEventListener('abort', () => {
        req.destroy()
        fileStream.close()
        try { fs.unlinkSync(safeDestPath) } catch {}
        record(0, 'timeout')
        resolve({ success: false, error: 'Download cancelled by AbortSignal' })
      }, { once: true })
    })
  }
}

export const webClient = new WebClient()
