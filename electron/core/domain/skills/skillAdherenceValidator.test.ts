import { describe, expect, it } from 'vitest'
import { validateSkillAdherence } from './skillAdherenceValidator'

const TAILWIND_SKILL = [
  '## CONTEXTUAL SKILLS & DOMAIN GUIDELINES (Active)',
  '### SKILL: tailwind-css-v4',
  '```markdown',
  '- In Tailwind v4, use `@import "tailwindcss";` at the top of your main CSS file.',
  '- DO NOT write `@tailwind base; @tailwind components; @tailwind utilities;`.',
  '- Prefer `@theme` variables instead of a JavaScript config.',
  '```',
].join('\n')

describe('validateSkillAdherence', () => {
  it('rejects legacy Tailwind directives explicitly forbidden by the active skill', () => {
    const result = validateSkillAdherence(
      'src/index.css',
      '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n',
      TAILWIND_SKILL
    )

    expect(result).toEqual({
      skillName: 'tailwind-css-v4',
      forbiddenFragment: '@tailwind base;',
    })
  })

  it('accepts the positive Tailwind v4 form and does not treat recommendations as prohibitions', () => {
    expect(validateSkillAdherence('src/index.css', '@import "tailwindcss";\n', TAILWIND_SKILL)).toBeNull()
  })

  it('does not enforce inactive context or block documentation quoting a forbidden example', () => {
    expect(validateSkillAdherence('src/index.css', '@tailwind base;', '')).toBeNull()
    expect(validateSkillAdherence('docs/migration.md', '@tailwind base;', TAILWIND_SKILL)).toBeNull()
    expect(validateSkillAdherence('README', '@tailwind base;', TAILWIND_SKILL)).toBeNull()
  })

  it('ignores positive code spans after an explicit alternative pivot', () => {
    const guidelines = [
      '### SKILL: example',
      '```markdown',
      '- Never use `legacy()`; instead use `modern()`.',
      '```',
    ].join('\n')

    expect(validateSkillAdherence('src/app.ts', 'modern()', guidelines)).toBeNull()
    expect(validateSkillAdherence('src/app.ts', 'legacy()', guidelines)).toEqual({
      skillName: 'example',
      forbiddenFragment: 'legacy()',
    })
  })
})
