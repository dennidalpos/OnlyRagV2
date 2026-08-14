import { describe, it, expect } from 'vitest'
import { DEFAULT_SKILL_HUB_URL } from '../coding/SkillHubModal'

function parsePagesFromMarkdown(markdown: string) {
  const text = markdown.trim()
  if (!text) return []

  const pageSplitRegex = /(?:^|\n)(?=## Page \d+|## Image)/i
  const rawParts = text.split(pageSplitRegex).map((p) => p.trim()).filter(Boolean)

  if (rawParts.length > 0 && rawParts.some((p) => /^## (?:Page \d+|Image)/i.test(p))) {
    let docTitlePreamble = ''
    const validPages: { pageNumber: number; content: string }[] = []

    for (let i = 0; i < rawParts.length; i++) {
      const part = rawParts[i]
      if (!/^## (?:Page \d+|Image)/i.test(part) && i === 0) {
        docTitlePreamble = part
      } else {
        const pageIndex = validPages.length + 1
        const content = validPages.length === 0 && docTitlePreamble
          ? `${docTitlePreamble}\n\n${part}`
          : part
        validPages.push({ pageNumber: pageIndex, content })
      }
    }

    if (validPages.length > 0) {
      return validPages
    }
  }

  const hrParts = text.split(/\n---\n/).map((p) => p.trim()).filter(Boolean)
  if (hrParts.length > 1) {
    return hrParts.map((part, idx) => ({ pageNumber: idx + 1, content: part }))
  }

  return [{ pageNumber: 1, content: text }]
}

describe('Document Ingestion Pagination & Parsing Tests', () => {
  it('should cleanly parse multi-page document with top title and ## Page markers without phantom duplicate pages', () => {
    const markdown = `# Document.pdf

## Page 1

First page content with intro.

## Page 2

Second page content with table:
| A | B |
|---|---|
| 1 | 2 |

## Page 3

Third page conclusion.`

    const pages = parsePagesFromMarkdown(markdown)
    expect(pages).toHaveLength(3)
    expect(pages[0].pageNumber).toBe(1)
    expect(pages[0].content).toContain('# Document.pdf')
    expect(pages[0].content).toContain('First page content with intro.')
    expect(pages[1].pageNumber).toBe(2)
    expect(pages[1].content).toContain('Second page content with table:')
    expect(pages[2].pageNumber).toBe(3)
    expect(pages[2].content).toContain('Third page conclusion.')
  })

  it('should cleanly parse documents separated by horizontal rules', () => {
    const markdown = `Section 1 content
---
Section 2 content
---
Section 3 content`

    const pages = parsePagesFromMarkdown(markdown)
    expect(pages).toHaveLength(3)
    expect(pages[0].pageNumber).toBe(1)
    expect(pages[0].content).toBe('Section 1 content')
    expect(pages[1].pageNumber).toBe(2)
    expect(pages[1].content).toBe('Section 2 content')
  })

  it('should handle single-page content cleanly', () => {
    const markdown = `# Single Page Doc
Simple text content without pages.`

    const pages = parsePagesFromMarkdown(markdown)
    expect(pages).toHaveLength(1)
    expect(pages[0].pageNumber).toBe(1)
    expect(pages[0].content).toContain('Simple text content without pages.')
  })

  it('should have a trusted default SKILL_HUB_URL defined', () => {
    expect(DEFAULT_SKILL_HUB_URL).toBeTruthy()
    expect(DEFAULT_SKILL_HUB_URL.startsWith('https://raw.githubusercontent.com/')).toBe(true)
    expect(DEFAULT_SKILL_HUB_URL.endsWith('SKILL.md')).toBe(true)
  })
})
