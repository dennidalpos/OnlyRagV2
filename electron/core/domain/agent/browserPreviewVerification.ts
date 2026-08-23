/**
 * Decides whether opening a target in the browser proves anything.
 *
 * `open_in_browser` used to satisfy the Definition of Done gate whatever it was pointed at.
 * In session-1787471833056-o5fk the agent opened `src/pages/Dashboard.tsx` — a TypeScript
 * source file — and that alone set `hasVerifiedBuild`, marked "Validate the interface at
 * 320px, 375px, 768px, 1024px and 1440px" as verified, and cleared the way to finish. The
 * project it certified could not start at all: `index.html` pointed at a `src/main.tsx` that
 * was never written.
 *
 * A browser renders a page or a document. Handed a source file it displays text, which
 * demonstrates nothing about whether the application builds or runs.
 */

/**
 * Document types a browser renders as itself. Deliberately narrow: this list decides what
 * counts as evidence, so anything ambiguous belongs outside it and falls through to a real
 * build or test command.
 */
const BROWSER_RENDERABLE_EXTENSIONS = new Set([
  '.html', '.htm', '.xhtml',
  '.svg', '.pdf',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif',
])

/**
 * True when opening `target` puts a rendered page or document on screen.
 *
 * A served URL qualifies — whatever is behind it has to have started to answer — as does a
 * renderable document on disk. A source file does not.
 */
export function isBrowserRenderableTarget(target: string | undefined | null): boolean {
  if (!target) return false

  const trimmed = String(target).trim()
  if (!trimmed) return false

  if (/^https?:\/\//i.test(trimmed)) return true

  // Strip a query string or fragment before reading the extension: "index.html?v=2" is still HTML.
  const withoutQuery = trimmed.split(/[?#]/)[0]
  const lastDot = withoutQuery.lastIndexOf('.')
  if (lastDot < 0) return false

  return BROWSER_RENDERABLE_EXTENSIONS.has(withoutQuery.slice(lastDot).toLowerCase())
}
