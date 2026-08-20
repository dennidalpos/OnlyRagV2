import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'
import { URL } from 'node:url'
import { logger } from '../../../diagnostics'
import { validatePathSafety } from '../../domain/agent/contextFilter'

export interface WebSearchResultItem {
  title: string
  url: string
  snippet: string
}

export function htmlToCleanMarkdown(html: string): string {
  if (!html || typeof html !== 'string') return ''

  let text = html
  // 1. Remove script, style, svg, noscript, nav, header, footer blocks
  text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
  text = text.replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '')
  text = text.replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '')
  text = text.replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '')
  text = text.replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '')

  // 2. Convert common markdown structural tags
  text = text.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n')
  text = text.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n')
  text = text.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n')
  text = text.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n')
  text = text.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '\n```\n$1\n```\n')
  text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1')
  text = text.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n$1\n')
  text = text.replace(/<br\s*\/?>/gi, '\n')
  text = text.replace(/<hr\s*\/?>/gi, '\n---\n')

  // 3. Strip remaining HTML tags
  text = text.replace(/<[^>]+>/g, ' ')

  // 4. Decode common HTML entities
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')

  // 5. Clean excessive whitespace and empty lines
  text = text.replace(/[ \t]+/g, ' ')
  text = text.replace(/\n\s*\n\s*\n+/g, '\n\n')
  return text.trim()
}

export function parseDuckDuckGoHtmlResults(html: string, maxResults: number = 8): WebSearchResultItem[] {
  const results: WebSearchResultItem[] = []
  if (!html) return results

  // Generic link and snippet extraction fallback
  const snippetMatches = [...html.matchAll(/<a[^>]+class="result__snippet[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
  const titleMatches = [...html.matchAll(/<a[^>]+class="result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]

  for (let i = 0; i < Math.min(titleMatches.length, maxResults); i++) {
    const rawUrl = titleMatches[i][1] || ''
    const rawTitle = titleMatches[i][2] || ''
    const rawSnippet = snippetMatches[i] ? snippetMatches[i][2] : ''

    // Clean DDG redirect url if present (e.g. //duckduckgo.com/l/?uddg=...)
    let cleanUrl = rawUrl
    try {
      if (rawUrl.includes('uddg=')) {
        const u = new URL(rawUrl.startsWith('http') ? rawUrl : `https:${rawUrl}`)
        const uddg = u.searchParams.get('uddg')
        if (uddg) cleanUrl = decodeURIComponent(uddg)
      }
    } catch {}

    const title = htmlToCleanMarkdown(rawTitle)
    const snippet = htmlToCleanMarkdown(rawSnippet)

    if (title && cleanUrl) {
      results.push({
        title,
        url: cleanUrl,
        snippet: snippet || title,
      })
    }
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

  async searchWeb(query: string, maxResults: number = 8): Promise<{ success: boolean; results: WebSearchResultItem[]; error?: string }> {
    if (!query || typeof query !== 'string' || !query.trim()) {
      return { success: false, results: [], error: 'Search query is empty' }
    }
    const cleanQuery = query.trim()
    logger.log('INFO', 'WebClient', `Executing web search for query: "${cleanQuery}"`)

    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(cleanQuery)}`
    const fetchRes = await this.fetchWebContent(searchUrl)

    if (!fetchRes.success || !fetchRes.content) {
      // Fallback: search via instant API
      return this.searchInstantApi(cleanQuery)
    }

    const results = parseDuckDuckGoHtmlResults(fetchRes.rawHtml || fetchRes.content, maxResults)
    if (results.length === 0) {
      return this.searchInstantApi(cleanQuery)
    }

    return { success: true, results }
  }

  private async searchInstantApi(query: string): Promise<{ success: boolean; results: WebSearchResultItem[]; error?: string }> {
    try {
      const apiUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
      const res = await this.fetchWebContent(apiUrl)
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

  async fetchWebContent(urlStr: string, maxChars: number = 16000): Promise<{ success: boolean; content?: string; rawHtml?: string; title?: string; error?: string }> {
    const urlCheck = this.validateUrlSafety(urlStr)
    if (!urlCheck.safeUrl) {
      return { success: false, error: urlCheck.error }
    }

    const targetUrl = urlCheck.safeUrl
    const isHttps = targetUrl.protocol === 'https:'
    const client = isHttps ? https : http

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
            const redirectUrl = new URL(res.headers.location, targetUrl).toString()
            return this.fetchWebContent(redirectUrl, maxChars).then(resolve)
          }

          if (res.statusCode && res.statusCode >= 400) {
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
        logger.log('WARN', 'WebClient', `Network error fetching ${urlStr}: ${err.message}`)
        resolve({ success: false, error: err.message })
      })

      req.on('timeout', () => {
        req.destroy()
        resolve({ success: false, error: `Request timed out (15s limit) for URL ${urlStr}` })
      })
    })
  }

  async downloadFile(
    urlStr: string,
    targetFilePath: string,
    workspaceRoot?: string | null
  ): Promise<{ success: boolean; downloadedBytes?: number; error?: string }> {
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

    return new Promise((resolve) => {
      try {
        fs.mkdirSync(path.dirname(safeDestPath), { recursive: true })
      } catch (dirErr: any) {
        return resolve({ success: false, error: `Failed creating directory: ${dirErr.message}` })
      }

      const fileStream = fs.createWriteStream(safeDestPath)
      let downloadedBytes = 0
      const MAX_FILE_BYTES = 100 * 1024 * 1024 // 100MB limit

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
            fileStream.close()
            try { fs.unlinkSync(safeDestPath) } catch {}
            const redirectUrl = new URL(res.headers.location, urlCheck.safeUrl!).toString()
            return this.downloadFile(redirectUrl, targetFilePath, workspaceRoot).then(resolve)
          }

          if (res.statusCode && res.statusCode >= 400) {
            fileStream.close()
            try { fs.unlinkSync(safeDestPath) } catch {}
            return resolve({ success: false, error: `HTTP ${res.statusCode} ${res.statusMessage || ''}` })
          }

          res.on('data', (chunk) => {
            downloadedBytes += chunk.length
            if (downloadedBytes > MAX_FILE_BYTES) {
              req.destroy()
              fileStream.close()
              try { fs.unlinkSync(safeDestPath) } catch {}
              resolve({ success: false, error: `Download exceeded 100MB safety limit.` })
            }
          })

          res.pipe(fileStream)

          fileStream.on('finish', () => {
            fileStream.close(() => {
              logger.log('INFO', 'WebClient', `Successfully downloaded ${downloadedBytes} bytes to ${safeDestPath}`)
              resolve({ success: true, downloadedBytes })
            })
          })
        }
      )

      req.on('error', (err) => {
        fileStream.close()
        try { fs.unlinkSync(safeDestPath) } catch {}
        resolve({ success: false, error: err.message })
      })

      req.on('timeout', () => {
        req.destroy()
        fileStream.close()
        try { fs.unlinkSync(safeDestPath) } catch {}
        resolve({ success: false, error: 'Download request timed out (60s limit)' })
      })
    })
  }
}

export const webClient = new WebClient()
