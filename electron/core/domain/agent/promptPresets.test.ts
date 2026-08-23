import { describe, it, expect } from 'vitest'
import { DEFAULT_FAMILY_PROMPTS } from './promptPresets'

/**
 * The chat presets are static: they are assembled into every chat turn regardless of whether a
 * document is attached. Any instruction about the "nothing selected" case therefore reaches the
 * model even when a document IS attached, and a small model cannot reliably pick the right
 * branch — llama3.2:3b answered "no document is selected, pick one from the left sidebar" to 3
 * of 5 questions while the retrieval had already returned two excerpts of the attached PDF.
 *
 * The state-specific directive belongs to the block useChatEngine assembles per turn, which is
 * the only place that knows the actual state. These tests keep the branch from creeping back.
 */

const CHAT_PRESETS = Object.entries(DEFAULT_FAMILY_PROMPTS.chat)

/** Phrases that only make sense when nothing is attached. */
const ABSENCE_INSTRUCTION_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'no-documents branch', pattern: /when no documents?\b/i },
  { label: 'no-attachments branch', pattern: /no attachments? (are|is) (currently )?selected/i },
  { label: 'invitation to pick a document', pattern: /select a document from the (left )?sidebar/i },
  { label: '@filename fallback hint', pattern: /mention '@filename'|use '@filename'/i },
]

describe('chat presets carry no "nothing is attached" branch', () => {
  it('defines at least one preset per model family', () => {
    expect(CHAT_PRESETS.length).toBeGreaterThan(0)
  })

  for (const { label, pattern } of ABSENCE_INSTRUCTION_PATTERNS) {
    it(`no chat preset contains the ${label}`, () => {
      const offenders = CHAT_PRESETS.filter(([, prompt]) => pattern.test(prompt)).map(([family]) => family)
      expect(offenders).toEqual([])
    })
  }

  it('still points every preset at the provided context', () => {
    const missing = CHAT_PRESETS.filter(([, prompt]) => !/context/i.test(prompt)).map(([family]) => family)
    expect(missing).toEqual([])
  })
})
