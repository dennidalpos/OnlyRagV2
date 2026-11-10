import path from 'node:path'

/** Returns true only when target is root itself or a descendant of root. */
export function isPathWithinRoot(root: string, target: string, allowRoot = true): boolean {
  const resolvedRoot = path.resolve(root)
  const resolvedTarget = path.resolve(target)
  if (allowRoot && resolvedTarget === resolvedRoot) return true
  const relative = path.relative(resolvedRoot, resolvedTarget)
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative)
}
