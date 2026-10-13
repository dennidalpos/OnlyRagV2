import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptDir, '..')

function displayPath(filePath, docsRoot) {
  return path.relative(path.dirname(docsRoot), filePath).split(path.sep).join('/')
}

function markdownFiles(docsRoot) {
  if (!fs.existsSync(docsRoot)) return []
  return fs.readdirSync(docsRoot, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(docsRoot, entry.name)
    if (entry.isDirectory()) return markdownFiles(entryPath)
    return entry.isFile() && entry.name.endsWith('.md') ? [entryPath] : []
  })
}

function localLinkTarget(rawTarget) {
  const target = rawTarget.trim().replace(/^<|>$/g, '').split('#', 1)[0].split('?', 1)[0]
  if (!target || target.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(target)) return null
  return target
}

function headingAnchors(content) {
  const counts = new Map()
  const anchors = new Set()
  for (const line of content.split(/\r?\n/)) {
    const match = /^#{1,6} (.+?)\s*#*\s*$/.exec(line)
    if (!match) continue
    const base = match[1]
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}_\- ]/gu, '')
      .replace(/ /g, '-')
    const count = counts.get(base) ?? 0
    anchors.add(count === 0 ? base : `${base}-${count}`)
    counts.set(base, count + 1)
  }
  return anchors
}

export function validateDocumentation({ docsRoot, packageJsonPath, additionalRoots = [], additionalFiles = [] }) {
  const errors = []
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
  const scripts = new Set(Object.keys(packageJson.scripts ?? {}))
  const files = [
    ...markdownFiles(docsRoot),
    ...additionalRoots.flatMap(markdownFiles),
    ...additionalFiles.filter((filePath) => filePath.endsWith('.md') && fs.existsSync(filePath)),
  ]
  const linkPattern = /\[[^\]]*\]\(([^)]+)\)/g
  const npmRunPattern = /\bnpm\s+run\s+([A-Za-z0-9:_-]+)/g
  const anchorsByPath = new Map()

  function anchorsFor(filePath) {
    if (!anchorsByPath.has(filePath)) anchorsByPath.set(filePath, headingAnchors(fs.readFileSync(filePath, 'utf8')))
    return anchorsByPath.get(filePath)
  }

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8')
    for (const match of content.matchAll(linkPattern)) {
      const target = localLinkTarget(match[1])
      if (target) {
        const resolved = path.resolve(path.dirname(filePath), target)
        if (!fs.existsSync(resolved)) errors.push(`${displayPath(filePath, docsRoot)}: broken local link '${target}'`)
      }
      const [targetPath, rawAnchor] = match[1].trim().replace(/^<|>$/g, '').split('#', 2)
      if (!rawAnchor || (targetPath && !target)) continue
      const resolved = targetPath ? path.resolve(path.dirname(filePath), targetPath.split('?', 1)[0]) : filePath
      if (!fs.existsSync(resolved) || path.extname(resolved).toLowerCase() !== '.md') continue
      let anchor
      try {
        anchor = decodeURIComponent(rawAnchor)
      } catch {
        continue
      }
      if (!anchorsFor(resolved).has(anchor)) errors.push(`${displayPath(filePath, docsRoot)}: broken local anchor '${match[1]}'`)
    }
    for (const match of content.matchAll(npmRunPattern)) {
      const scriptName = match[1]
      if (!scripts.has(scriptName)) errors.push(`${displayPath(filePath, docsRoot)}: undocumented npm script '${scriptName}' does not exist in package.json`)
    }
  }

  return { filesChecked: files.length, errors }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const usesDefaultDocsRoot = process.argv[2] === undefined
  const result = validateDocumentation({
    docsRoot: path.resolve(process.argv[2] ?? path.join(repositoryRoot, 'docs')),
    packageJsonPath: path.resolve(process.argv[3] ?? path.join(repositoryRoot, 'package.json')),
    additionalRoots: usesDefaultDocsRoot ? [path.join(repositoryRoot, 'skills')] : [],
    additionalFiles: usesDefaultDocsRoot
      ? [
          path.join(repositoryRoot, 'README.md'),
          path.join(repositoryRoot, 'AGENTS.md'),
          path.join(repositoryRoot, 'DISTRIBUTION-LICENSE.md'),
          path.join(repositoryRoot, 'sidecar', 'tests', 'fixtures', 'README.md'),
        ]
      : [],
  })
  if (result.errors.length > 0) {
    console.error(`Documentation validation failed with ${result.errors.length} error(s):`)
    for (const error of result.errors) console.error(`- ${error}`)
    process.exitCode = 1
  } else console.log(`Documentation validation passed: ${result.filesChecked} Markdown file(s) checked.`)
}
