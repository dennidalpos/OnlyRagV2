import { describe, it, expect } from 'vitest'
import { getPageLineNumber, getTotalLines } from './useIngestion'

describe('useIngestion page line calculation and pagination sync', () => {
  const sampleMarkdown = `# Document Title

## Page 1
First line of page 1.
Second line of page 1.

## Page 2
First line of page 2.
Table line:
| A | B |
|---|---|
| 1 | 2 |

## Page 3
First line of page 3.
`

  it('correctly maps page numbers to 1-based markdown line numbers', () => {
    expect(getPageLineNumber(sampleMarkdown, 1)).toBe(1)
    expect(getPageLineNumber(sampleMarkdown, 2)).toBe(7)
    expect(getPageLineNumber(sampleMarkdown, 3)).toBe(14)
  })

  it('falls back to 1 for invalid or first page', () => {
    expect(getPageLineNumber('', 1)).toBe(1)
    expect(getPageLineNumber(sampleMarkdown, 0)).toBe(1)
    expect(getPageLineNumber(sampleMarkdown, -1)).toBe(1)
  })

  it('supports horizontal rule separator fallback', () => {
    const hrMarkdown = `Section 1 content
---
Section 2 content
---
Section 3 content`

    expect(getPageLineNumber(hrMarkdown, 1)).toBe(1)
    expect(getPageLineNumber(hrMarkdown, 2)).toBe(3)
    expect(getPageLineNumber(hrMarkdown, 3)).toBe(5)
  })

  it('calculates total line count accurately', () => {
    expect(getTotalLines(sampleMarkdown)).toBe(16)
    expect(getTotalLines('')).toBe(1)
  })
})
