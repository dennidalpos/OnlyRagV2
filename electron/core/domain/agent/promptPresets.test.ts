import { describe, it, expect } from 'vitest'
import {
  DEFAULT_CHAT_PROMPT,
  DEFAULT_TRANSLATION_PROMPT,
  DEFAULT_IMAGE_ANALYSIS_PROMPT,
  DEFAULT_CODING_PROMPT,
  CODING_CORE_DIRECTIVES,
  CODING_TOOLS_BLOCK,
} from './promptPresets'
import { ALL_PROMPT_NODES } from './promptHierarchyRegistry'

/**
 * The chat prompt is static: it is assembled into every chat turn regardless of whether a document
 * is attached. Any instruction about the "nothing selected" case therefore reaches the model even
 * when a document IS attached, and a small model cannot reliably pick the right branch —
 * llama3.2:3b answered "no document is selected, pick one from the left sidebar" to 3 of 5
 * questions while the retrieval had already returned two excerpts of the attached PDF.
 *
 * The state-specific directive belongs to the block useChatEngine assembles per turn, which is the
 * only place that knows the actual state.
 */
const ABSENCE_INSTRUCTION_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'no-documents branch', pattern: /when no documents?\b/i },
  { label: 'no-attachments branch', pattern: /no attachments? (are|is) (currently )?selected/i },
  { label: 'invitation to pick a document', pattern: /select a document from the (left )?sidebar/i },
  { label: '@filename fallback hint', pattern: /mention '@filename'|use '@filename'/i },
]

describe('chat prompt carries no "nothing is attached" branch', () => {
  for (const { label, pattern } of ABSENCE_INSTRUCTION_PATTERNS) {
    it(`does not contain the ${label}`, () => {
      expect(pattern.test(DEFAULT_CHAT_PROMPT)).toBe(false)
    })
  }
})

/**
 * The per-family matrix these prompts replaced drifted apart: 7 of its 23 real chat presets never
 * named the document context block, and 9 of 23 translation presets — `generic` among them — never
 * asked for Markdown preservation. With one prompt per module that class of omission can only
 * happen once, so it is worth pinning down.
 */
describe('core directives survive in the consolidated prompts', () => {
  it('the chat prompt names the document context block and the temporal anchor', () => {
    expect(DEFAULT_CHAT_PROMPT).toContain('[INDEXED DOCUMENT CONTEXT (LanceDB)]')
    expect(DEFAULT_CHAT_PROMPT).toContain('[TEMPORAL CONTEXT]')
    expect(DEFAULT_CHAT_PROMPT).toContain('CRITICAL LANGUAGE DIRECTIVE')
  })

  it('the translation prompt preserves Markdown and forbids preambles', () => {
    expect(DEFAULT_TRANSLATION_PROMPT).toMatch(/PRESERVE ALL MARKDOWN FORMATTING/i)
    expect(DEFAULT_TRANSLATION_PROMPT).toMatch(/Output ONLY the translated markdown content/i)
    expect(DEFAULT_TRANSLATION_PROMPT).toContain('{{sourceLang}}')
    expect(DEFAULT_TRANSLATION_PROMPT).toContain('{{targetLang}}')
  })

  it('the image analysis prompt demands OCR fidelity and flags illegible regions', () => {
    expect(DEFAULT_IMAGE_ANALYSIS_PROMPT).toMatch(/OCR fidelity/i)
    expect(DEFAULT_IMAGE_ANALYSIS_PROMPT).toMatch(/illegible or cut off/i)
    expect(DEFAULT_IMAGE_ANALYSIS_PROMPT).toContain('CRITICAL LANGUAGE DIRECTIVE')
  })

  it('the coding directives keep the anti-loop and verification gates', () => {
    expect(CODING_CORE_DIRECTIVES).toMatch(/NEVER SURRENDER/)
    expect(CODING_CORE_DIRECTIVES).toMatch(/VERIFY FOR REAL/)
    expect(CODING_CORE_DIRECTIVES).toMatch(/ONE MILESTONE AT A TIME/)
    expect(CODING_CORE_DIRECTIVES).toMatch(/CURRENT LIBRARY FACTS/)
    expect(CODING_CORE_DIRECTIVES).toMatch(/web_search/)
    expect(CODING_CORE_DIRECTIVES).toMatch(/fetch_web_content/)
  })

  it('makes current-library research a conditional two-step action', () => {
    expect(CODING_CORE_DIRECTIVES).toContain('ACTIONABLE TRIGGER')
    expect(CODING_CORE_DIRECTIVES).toMatch(/NEXT tool call MUST be web_search/)
    expect(CODING_CORE_DIRECTIVES).toMatch(/IMMEDIATE NEXT tool call MUST be fetch_web_content/)
    expect(CODING_CORE_DIRECTIVES).toMatch(/untrusted reference data/i)
  })

  it('the tool block still advertises the finish tool', () => {
    expect(CODING_TOOLS_BLOCK).toContain('- finish:')
  })
})

describe('template wiring', () => {
  it('the coding master references both child nodes as partials', () => {
    expect(DEFAULT_CODING_PROMPT).toContain('{{> directives}}')
    expect(DEFAULT_CODING_PROMPT).toContain('{{> tools}}')
  })

  it('gates the tool partial on the native tool-calling capability', () => {
    expect(DEFAULT_CODING_PROMPT).toMatch(/\{\{\^nativeToolCalling\}\}.*\{\{> tools\}\}.*\{\{\/nativeToolCalling\}\}/s)
  })

  it('no default carries legacy single-brace placeholders', () => {
    for (const node of ALL_PROMPT_NODES) {
      expect(node.defaultValue, `${node.id} still uses {singleBrace} syntax`).not.toMatch(/(^|[^{]){[a-zA-Z_][a-zA-Z0-9_]*}/)
    }
  })

  it('no default mentions a specific model brand', () => {
    const brands = /\b(Qwen|Llama|DeepSeek|Mistral|Gemma|Phi-\d|Granite|Hermes|Nemotron|SmolLM|EXAONE|StarCoder|LLaVA|MiniCPM|Moondream)\b/
    for (const node of ALL_PROMPT_NODES) {
      expect(node.defaultValue, `${node.id} names a model brand`).not.toMatch(brands)
    }
  })
})
