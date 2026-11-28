import { describe, expect, it } from 'vitest'
import { declaredMajorVersion, skillsFittingDeclaredVersions, skillVersionConflict } from './skillVersionFit'

describe('declaredMajorVersion', () => {
  it('reads the major a range pins', () => {
    expect(declaredMajorVersion('^3.4.1')).toBe(3)
    expect(declaredMajorVersion('~3')).toBe(3)
    expect(declaredMajorVersion('3.x')).toBe(3)
    expect(declaredMajorVersion('>=3.0.0 <4')).toBe(3)
    expect(declaredMajorVersion('4.1.0')).toBe(4)
  })

  it('pins nothing for open, union, tag and non-registry ranges', () => {
    for (const range of ['*', 'latest', '>=3', '^3 || ^4', 'workspace:*', 'github:tailwindlabs/tailwindcss', '']) {
      expect(declaredMajorVersion(range)).toBeNull()
    }
  })
})

describe('skillVersionConflict', () => {
  it('flags a versioned skill whose package the workspace declares at another major', () => {
    expect(skillVersionConflict('tailwind-css-v4', { tailwindcss: '^3.4.1', react: '^18.2.0' })).toEqual({
      skillName: 'tailwind-css-v4',
      packageName: 'tailwindcss',
      skillMajor: 4,
      declaredRange: '^3.4.1',
    })
  })

  it('accepts the same major, undeclared packages and unversioned skills', () => {
    expect(skillVersionConflict('tailwind-css-v4', { tailwindcss: '^4.0.0' })).toBeNull()
    expect(skillVersionConflict('tailwind-css-v4', { react: '^18.2.0' })).toBeNull()
    expect(skillVersionConflict('react-best-practices', { react: '^17.0.0' })).toBeNull()
  })

  it('matches scoped package names by their bare name', () => {
    expect(skillVersionConflict('react-query-v5', { '@tanstack/react-query': '^4.36.1' })?.packageName).toBe('@tanstack/react-query')
  })
})

describe('skillsFittingDeclaredVersions', () => {
  const skills = [{ name: 'tailwind-css-v4' }, { name: 'react-components' }]

  it('drops only the contradicting skills', () => {
    expect(skillsFittingDeclaredVersions(skills, { tailwindcss: '^3.4.1' }).map((s) => s.name)).toEqual(['react-components'])
  })

  it('keeps every skill before a manifest declares anything', () => {
    expect(skillsFittingDeclaredVersions(skills, undefined)).toEqual(skills)
    expect(skillsFittingDeclaredVersions(skills, {})).toEqual(skills)
  })
})
