import { describe, expect, it } from 'vitest'
import { buildVersionAnswer, isVersionQuestion, MAX_VERSION_QUESTION_PACKAGES, versionQuestionPackages } from './versionQuestion'

describe('isVersionQuestion', () => {
  it('recognizes version questions in English and Italian', () => {
    expect(isVersionQuestion('Which versions of react and vite should I use?')).toBe(true)
    expect(isVersionQuestion('Quale versione di vitest devo usare?')).toBe(true)
    expect(isVersionQuestion('Should I proceed with the next milestone?')).toBe(false)
  })
})

describe('versionQuestionPackages', () => {
  const declared = ['react', 'react-dom', '@types/react', 'vite']

  it('keeps the declared packages the question names, without prefix matches', () => {
    expect(versionQuestionPackages('Which version of react should I pin?', declared)).toEqual(['react'])
  })

  it('adds packages written as name@version', () => {
    expect(versionQuestionPackages('Is vitest@0.26 the right version?', declared)).toEqual(['vitest'])
  })

  it('falls back to every declared dependency when the question names none', () => {
    expect(versionQuestionPackages('Which dependency versions should I use?', declared)).toEqual(declared)
  })

  it('bounds the lookup', () => {
    const many = Array.from({ length: 20 }, (_, index) => `pkg${index}`)
    expect(versionQuestionPackages('Which versions?', many)).toHaveLength(MAX_VERSION_QUESTION_PACKAGES)
  })
})

describe('buildVersionAnswer', () => {
  it('turns registry facts into versions to declare', () => {
    const answer = buildVersionAnswer(
      [
        { name: 'react', exists: true, latest: '19.1.0', versions: ['18.3.1', '19.1.0'] },
        { name: 'tailwindcss', exists: true, latest: '4.1.0', versions: ['3.4.17', '4.1.0'] },
        { name: 'vite', exists: true, latest: '7.0.0', versions: ['7.0.0'] },
        { name: 'vitest', exists: true, latest: '3.2.0', versions: ['3.2.0'] },
        { name: 'not-a-package', exists: false },
      ],
      [
        { name: 'react', range: '^18.2.0' },
        { name: 'tailwindcss', range: '^3.4.0' },
        { name: 'vite', range: '^9.0.0' },
      ],
    )

    expect(answer).toContain('[AUTONOMOUS VERSION ANSWER: DO NOT ASK ABOUT VERSIONS]')
    expect(answer).toContain('- react: declared ^18.2.0 is a major behind; declare "^19.1.0".')
    expect(answer).toContain('- tailwindcss: keep the declared ^3.4.0 (latest published 4.1.0).')
    expect(answer).toContain('- vite: the declared ^9.0.0 matches no published release; declare "^7.0.0".')
    expect(answer).toContain('- vitest: declare "^3.2.0" (latest published).')
    expect(answer).toContain('- not-a-package: does not exist on npm.')
  })

  it('answers without facts when no package is known', () => {
    expect(buildVersionAnswer([], [])).toContain('Declare the current published version of each package')
  })
})
