import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../i18n'
import type { ChatMessage } from '../../types'
import { ChatMessageItem } from './ChatMessageItem'

describe('retrieved candidate scores', () => {
  it.each([false, true])('opens cited original locations or exposes their stale failure (%s)', async (stale) => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const revision = 'a'.repeat(64)
    const request = {
      docId: 'doc',
      chunkId: 'doc_chunk_0',
      sourceRevision: revision,
      extractionRevision: revision,
      indexRevision: revision,
      spanStart: 10,
      spanEnd: 29,
    }
    const getSourceLocation = vi.fn(async () => {
      if (stale) throw new Error('Stale revision')
      return {
        doc_id: 'doc',
        chunk_id: 'doc_chunk_0',
        source_revision: revision,
        extraction_revision: revision,
        index_revision: revision,
        span_start: 10,
        span_end: 29,
        exact_quote: 'Payment in 21 days.',
        page_number: 2,
        image_base64: 'iVBOR',
      }
    })
    Object.assign(window, { electronAPI: { getSourceLocation } })
    const message: ChatMessage = {
      id: 'answer',
      sender: 'bot',
      timestamp: '12:00',
      text: 'Payment in 21 days [S1]. Unknown [S99].',
      invalidSourceReferences: ['S99'],
      sources: [
        {
          docId: 'doc',
          chunkId: 'doc_chunk_0',
          docName: 'contract.pdf',
          score: 0.2,
          snippet: 'Payment in 21 days.',
          referenceId: 'S1',
          citationState: 'cited',
          provenance: {
            version: 1,
            source_revision: revision,
            extraction_revision: revision,
            index_revision: revision,
            location_kind: 'original',
            span_start: 10,
            span_end: 29,
            exact_quote: 'Payment in 21 days.',
          },
        },
      ],
    }
    try {
      await act(async () =>
        root.render(
          <I18nProvider initialLanguage="en">
            <ChatMessageItem msg={message} isCopied={false} copiedCitationIndex={null} onCopyMessage={vi.fn()} onCopyCitation={vi.fn()} />
          </I18nProvider>,
        ),
      )
      const reference = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '[S1]')!
      expect(reference).toBeDefined()
      expect(Array.from(container.querySelectorAll('button')).some((button) => button.textContent === '[S99]')).toBe(false)
      expect(container.textContent).toContain('Unresolved references: S99')
      expect(container.textContent).not.toContain('Original location verified')
      await act(async () => reference.click())
      expect(getSourceLocation).toHaveBeenCalledWith(request)
      if (stale) {
        expect(document.querySelector('[role="alert"]')?.textContent).toContain('Stale revision')
        expect(document.body.textContent).not.toContain('Original location verified')
      } else {
        expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Original location verified. Page 2')
        expect(document.querySelector('[role="dialog"]')?.textContent).toContain('compare the passage with the answer')
        expect(document.querySelector('[role="dialog"] img')?.getAttribute('src')).toBe('data:image/png;base64,iVBOR')
      }
      await act(async () => document.querySelector<HTMLButtonElement>('[role="dialog"] button')?.click())
      getSourceLocation.mockClear()
      message.sources![0].citationState = 'candidate'
      const renderCandidate = () =>
        root.render(
          <I18nProvider initialLanguage="en">
            <ChatMessageItem msg={{ ...message }} isCopied={false} copiedCitationIndex={null} onCopyMessage={vi.fn()} onCopyCitation={vi.fn()} />
          </I18nProvider>,
        )
      await act(async () => renderCandidate())
      expect(container.textContent).toContain('Retrieved candidate, not cited in the answer.')
      expect(Array.from(container.querySelectorAll('button')).some((button) => ['[S1]', 'Open original location'].includes(button.textContent || ''))).toBe(
        false,
      )
      message.sources![0].citationState = 'cited'
      message.isStreaming = true
      await act(async () => renderCandidate())
      expect(Array.from(container.querySelectorAll('button')).some((button) => ['[S1]', 'Open original location'].includes(button.textContent || ''))).toBe(
        false,
      )
      expect(getSourceLocation).not.toHaveBeenCalled()
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
  it.each([
    ['en', 'Retrieved passages', 'Ranking score: 0.225', 'not confidence'],
    ['it', 'Estratti recuperati', 'Ordinamento: 0.225', 'non misura la certezza'],
  ] as const)('does not present an unrelated ranking score as evidence confidence (%s)', async (language, heading, score, meaning) => {
    const container = document.createElement('div')
    const root = createRoot(container)
    const message: ChatMessage = {
      id: 'answer',
      sender: 'bot',
      timestamp: '12:00',
      text: 'The supplied passages do not answer this question.',
      sources: [{ chunkId: 'unrelated', docName: 'notes.md', score: 0.225, snippet: 'Unrelated passage.' }],
    }
    try {
      await act(async () =>
        root.render(
          <I18nProvider initialLanguage={language}>
            <ChatMessageItem msg={message} isCopied={false} copiedCitationIndex={null} onCopyMessage={vi.fn()} onCopyCitation={vi.fn()} />
          </I18nProvider>,
        ),
      )
      expect(container.textContent).toContain(heading)
      expect(container.textContent).toContain(score)
      expect(container.textContent).toContain(meaning)
      expect(container.textContent).not.toContain('%')
      expect(container.textContent).toContain('Unrelated passage.')
    } finally {
      await act(async () => root.unmount())
    }
  })
})
