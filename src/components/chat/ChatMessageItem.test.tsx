import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../i18n'
import type { ChatMessage } from '../../types'
import { ChatMessageItem } from './ChatMessageItem'

describe('retrieved candidate scores', () => {
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
