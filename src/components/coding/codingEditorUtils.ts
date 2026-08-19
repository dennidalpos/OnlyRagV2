export function getLanguageFromExtension(filename?: string): string {
  if (!filename) return 'typescript'
  if (filename.endsWith('.tsx') || filename.endsWith('.ts')) return 'typescript'
  if (filename.endsWith('.json')) return 'json'
  if (filename.endsWith('.py')) return 'python'
  if (filename.endsWith('.css')) return 'css'
  if (filename.endsWith('.html')) return 'html'
  if (filename.endsWith('.md')) return 'markdown'
  return 'plaintext'
}

export function getBreadcrumbParts(filePath: string | undefined, noFileOpenLabel: string): string[] {
  if (!filePath) return [noFileOpenLabel]
  const normalized = filePath.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  return parts.length > 5 ? ['...', ...parts.slice(-4)] : parts
}
