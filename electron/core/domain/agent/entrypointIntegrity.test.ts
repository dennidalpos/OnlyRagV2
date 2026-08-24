import { describe, it, expect } from 'vitest'
import { buildEntrypointDirective, checkHtmlEntrypoint, extractLocalScriptSources } from './entrypointIntegrity'

/** The page the agent produced on 2026-08-25: valid HTML that references nothing. */
const EMPTY_PAGE = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Project Dashboard Task</title></head>
<body>
    <!-- Application will be rendered here -->
</body></html>`

const WIRED_PAGE = EMPTY_PAGE.replace(
  '<!-- Application will be rendered here -->',
  '<div id="root"></div><script type="module" src="/src/main.tsx"></script>'
)

describe('extractLocalScriptSources', () => {
  it('finds a local module script whatever the attribute order', () => {
    expect(extractLocalScriptSources('<script src="/src/main.tsx" type="module"></script>')).toEqual(['/src/main.tsx'])
  })

  it('ignores absolute URLs, which are never this project entry', () => {
    // A page that loads React from a CDN and its own code from nowhere is exactly the case
    // this check must still catch.
    expect(extractLocalScriptSources('<script src="https://cdn.example.com/react.js"></script>')).toEqual([])
    expect(extractLocalScriptSources('<script src="//cdn.example.com/x.js"></script>')).toEqual([])
  })

  it('finds nothing in a page with no script tag', () => {
    expect(extractLocalScriptSources(EMPTY_PAGE)).toEqual([])
  })
})

describe('checkHtmlEntrypoint', () => {
  it('reports the page that loads nothing while an entry exists on disk', () => {
    const verdict = checkHtmlEntrypoint(EMPTY_PAGE, ['src/main.tsx'])

    expect(verdict.ok).toBe(false)
    expect(verdict.expectedEntry).toBe('src/main.tsx')
  })

  it('accepts a page that does reference the entry', () => {
    expect(checkHtmlEntrypoint(WIRED_PAGE, ['src/main.tsx']).ok).toBe(true)
  })

  it('stays silent when the project has no conventional entry on disk', () => {
    // Nothing to be wired to; accusing the page would be inventing a defect.
    expect(checkHtmlEntrypoint(EMPTY_PAGE, []).ok).toBe(true)
  })

  it('stays silent when the page loads some other local script', () => {
    // The project may boot in a way this rule does not model, and a false accusation sends the
    // model rewriting a file that was already correct.
    expect(checkHtmlEntrypoint('<script src="/bootstrap.js"></script>', ['src/main.tsx']).ok).toBe(true)
  })

  it('prefers main over index when both are present', () => {
    expect(checkHtmlEntrypoint(EMPTY_PAGE, ['src/index.tsx', 'src/main.tsx']).expectedEntry).toBe('src/main.tsx')
  })
})

describe('buildEntrypointDirective', () => {
  it('gives the exact tag rather than an instruction to "wire it up"', () => {
    const directive = buildEntrypointDirective('index.html', 'src/main.tsx')

    expect(directive).toContain('<script type="module" src="/src/main.tsx"></script>')
    expect(directive).toContain('<div id="root"></div>')
  })

  it('explains why the check passed anyway, so the model can reconcile the two', () => {
    expect(buildEntrypointDirective('index.html', 'src/main.tsx')).toContain('A typecheck cannot catch this')
  })

  it('says the page is what is wrong, not the entry', () => {
    expect(buildEntrypointDirective('index.html', 'src/main.tsx')).toContain('The page is what is wrong')
  })
})
