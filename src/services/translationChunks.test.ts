import { describe, expect, it } from 'vitest'
import { prepareTranslationPrompts, splitMarkdownForTranslation } from './translationChunks'
import { countPromptTokens } from '../../shared/domain/agent/contextWindowCalculator'
import { IPC_TEXT_MAX_LENGTH } from '../../shared/ipc/textLimits'

describe('translation input planning', () => {
  it.each(['```', '~~~~', '````'])('keeps %s code with internal blank paragraphs and a boundary closing fence intact', (fence) => {
    const code = `${fence}ts\n${'const x = 1;\n\n'.repeat(260)}${fence}\n`
    const source = `Intro\n\n${code}\nEnd`
    const { prompts } = prepareTranslationPrompts(source, 'Translate exactly.', 32768)
    const chunks = prompts.map((prompt) => prompt.split('[DOCUMENT CONTENT TO TRANSLATE]:\n')[1])
    expect(chunks.join('')).toBe(source)
    expect(chunks.some((chunk) => chunk.includes(code))).toBe(true)
    expect(chunks.every((chunk) => !chunk.includes(fence) || chunk.includes(code))).toBe(true)
  })

  it('does not treat shorter or different fences or page markers inside code as boundaries', () => {
    const source = '````md\n## Page 2\n```\n\n~~~\n````\n\n## Page 3\nAfter'
    const chunks = splitMarkdownForTranslation(source, 70)
    expect(chunks.join('')).toBe(source)
    expect(chunks[0]).toContain('````md\n## Page 2\n```\n\n~~~\n````')
  })

  it.each(['## Page 1', '# Page 1', '--- Page 1 ---'])('preserves page headers, whitespace and CRLF: %s', (header) => {
    const source = ` \r\n${header}\r\nTest\r\n\r\n${header.replace('1', '2')}\r\nEnd\r\n`
    const chunks = splitMarkdownForTranslation(source, 70)
    expect(chunks.join('')).toBe(source)
    expect(chunks.some((chunk) => chunk.startsWith(header.replace('1', '2')))).toBe(true)
  })

  it('splits a 130000 character paragraph without losing text or exceeding the complete IPC/context budget', () => {
    const source = 'A'.repeat(130000)
    const { prompts, numPredict } = prepareTranslationPrompts(source, 'Translate.', 2048)
    expect(prompts.map((p) => p.split('[DOCUMENT CONTENT TO TRANSLATE]:\n')[1]).join('')).toBe(source)
    expect(prompts.length).toBeGreaterThan(1)
    for (const prompt of prompts) {
      expect(prompt.length).toBeLessThanOrEqual(IPC_TEXT_MAX_LENGTH)
      expect(countPromptTokens(prompt) + numPredict + 256).toBeLessThanOrEqual(2048)
    }
  })

  it('keeps Unicode code points and exact source order across budget cuts', () => {
    const source = '🙂漢字é Καλημέρα\r\n'.repeat(300)
    const { prompts, numPredict } = prepareTranslationPrompts(source, 'Traduci.', 2048)
    const chunks = prompts.map((p) => p.split('[DOCUMENT CONTENT TO TRANSLATE]:\n')[1])
    expect(chunks.join('')).toBe(source)
    for (const [i, chunk] of chunks.entries()) {
      expect(chunk).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u)
      expect(countPromptTokens(prompts[i]) + numPredict + 256).toBeLessThanOrEqual(2048)
    }
  })

  it('includes custom instructions in IPC admission and retains a fitting near-limit prefix', () => {
    const instruction = 'a'.repeat(119900)
    const { prompts } = prepareTranslationPrompts('Short source', instruction, 131072)
    expect(prompts[0].length).toBeLessThanOrEqual(120000)
    expect(() => prepareTranslationPrompts('source', instruction + 'a'.repeat(100), 131072)).toThrow('budget')
  })

  it.each(['```ts\nunfinished', '~~~\nunfinished'])('refuses unclosed fences before dispatch: %s', (source) => {
    expect(() => prepareTranslationPrompts(source, 'Translate', 8192)).toThrow('fence')
  })

  it('refuses an oversized fenced block instead of cutting code or dispatching a partial plan', () => {
    expect(() => prepareTranslationPrompts('First\n\n```\n' + 'word '.repeat(10000) + '\n```', 'Translate', 2048)).toThrow('budget')
  })

  it('refuses instructions that already exceed the context budget', () => {
    expect(() => prepareTranslationPrompts('source', 'word '.repeat(3000), 2048)).toThrow('budget')
  })
})
