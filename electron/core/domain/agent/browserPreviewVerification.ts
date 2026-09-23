/** Document types a browser renders as itself. */
const BROWSER_RENDERABLE_EXTENSIONS = new Set(['.html', '.htm', '.xhtml', '.svg', '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif'])

/** True when opening `target` puts a rendered page or document on screen. */
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
