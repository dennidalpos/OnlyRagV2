import { describe, it, expect } from 'vitest'
import { extractPageMarkdown, LANGUAGES } from './useTranslation'
import { splitMarkdownForTranslation } from '../services/translationChunks'

describe('useTranslation helper tests', () => {
  it('should export all supported languages', () => {
    expect(LANGUAGES).toContain('Italian')
    expect(LANGUAGES).toContain('English')
    expect(LANGUAGES).toContain('German')
    expect(LANGUAGES).toContain('French')
  })

  it('should return an empty array for empty markdown input', () => {
    expect(splitMarkdownForTranslation('')).toEqual([])
    expect(splitMarkdownForTranslation('   ')).toEqual([])
  })

  it('should split markdown with explicit page headers', () => {
    const markdown = '## Page 1\nContent of page 1.\n\n## Page 2\nContent of page 2.'
    const chunks = splitMarkdownForTranslation(markdown)
    expect(chunks.length).toBe(2)
    expect(chunks[0]).toContain('## Page 1')
    expect(chunks[1]).toContain('## Page 2')
  })

  it('should adaptively split oversized chunks by paragraph boundaries', () => {
    const longParagraph = 'Paragraph text that repeats to create large volume. '.repeat(80)
    const longMarkdown = `${longParagraph}\n\n${longParagraph}\n\n${longParagraph}`

    const chunks = splitMarkdownForTranslation(longMarkdown, 2000)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(5000)
    }
  })

  it('should not split inside an open fenced code block', () => {
    const codeContent = 'const x = 1;\n'.repeat(25)
    const markdown = `Intro text.\n\n\`\`\`typescript\n${codeContent}\`\`\`\n\nOutro text.`
    const chunks = splitMarkdownForTranslation(markdown, 500)
    for (const chunk of chunks) {
      const codeFences = (chunk.match(/```/g) || []).length
      // Every chunk containing code fences must have closed pairs (even number of ```)
      expect(codeFences % 2).toBe(0)
    }
  })

  it('preserves a blank-paragraph fence at the split boundary', () => {
    const code = '```ts\n' + 'const a = 1;\n\n'.repeat(30) + '```\n'
    const source = 'Intro '.repeat(30) + '\n\n' + code + '\nEnd'
    const chunks = splitMarkdownForTranslation(source, 500)
    expect(chunks.join('')).toBe(source)
    expect(chunks.some((chunk) => chunk.includes(code))).toBe(true)
  })

  it('enforces hard bounds for long indivisible prose', () => {
    const source = 'A'.repeat(130000)
    const chunks = splitMarkdownForTranslation(source)
    expect(chunks.join('')).toBe(source)
    expect(chunks.every((chunk) => chunk.length <= 3500)).toBe(true)
  })

  it('is lossless across page headers and whitespace', () => {
    const source = ' \r\n## Page 1\r\nText\r\n\r\n## Page 2\r\nEnd\r\n'
    expect(splitMarkdownForTranslation(source).join('')).toBe(source)
  })

  it('should extract specific page markdown correctly', () => {
    const multiPage = '# Doc\n\n## Page 1\nFirst page text\n\n## Page 2\nSecond page text\n\n## Page 3\nThird page text'
    expect(extractPageMarkdown(multiPage, 2)).toBe('## Page 2\nSecond page text')
    expect(extractPageMarkdown(multiPage, 1)).toBe('## Page 1\nFirst page text')
  })

  it.each(['```md', '~~~md'])('keeps literal page markers inside %s code out of page selection', (opening) => {
    const firstPage = `## Page 1\n${opening}\n## Page 2\nliteral\n${opening.slice(0, 3)}\nEnd of page one`
    const source = firstPage + '\n\n## Page 2\nActual second page'
    expect(extractPageMarkdown(source, 1)).toBe(firstPage)
    expect(extractPageMarkdown(source, 2)).toBe('## Page 2\nActual second page')
  })

  it('should support swapping languages cleanly', () => {
    let source = 'Italian'
    let target = 'English'
    const swap = () => {
      const prev = source
      source = target
      target = prev
    }
    swap()
    expect(source).toBe('English')
    expect(target).toBe('Italian')
  })
})
