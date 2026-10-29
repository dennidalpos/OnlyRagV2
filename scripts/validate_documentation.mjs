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

const mermaidHeaderPattern = /^(?:flowchart|graph)\s+(?:TD|TB|LR|RL|BT)$/
const mermaidNodePattern = /^([A-Za-z][A-Za-z0-9_]*)\s*(\(\["[^"\n]+"\]\)|\["[^"\n]+"\]|\{"[^"\n]+"\})$/
const mermaidEdgePattern =
  /^([A-Za-z][A-Za-z0-9_]*)(?:\s*(\(\["[^"\n]+"\]\)|\["[^"\n]+"\]|\{"[^"\n]+"\}))?\s*(-->|--\s*"[^"\n]+"\s*-->)\s*([A-Za-z][A-Za-z0-9_]*)(?:\s*(\(\["[^"\n]+"\]\)|\["[^"\n]+"\]|\{"[^"\n]+"\}))?$/

function unwrapMermaidLabel(shape) {
  if (shape.startsWith('(["') && shape.endsWith('"])')) return shape.slice(3, -3)
  if (shape.startsWith('["') && shape.endsWith('"]')) return shape.slice(2, -2)
  if (shape.startsWith('{"') && shape.endsWith('"}')) return shape.slice(2, -2)
  return shape
}

function validateMermaidBlocks(content, fileLabel, errors) {
  const fenceMatches = [...content.matchAll(/^```mermaid[^\r\n]*$/gm)]
  const blockMatches = [...content.matchAll(/^```mermaid[^\r\n]*\r?\n([\s\S]*?)\r?\n```$/gm)]
  if (fenceMatches.length !== blockMatches.length) {
    errors.push(`${fileLabel}: unclosed mermaid code fence`)
    return
  }

  blockMatches.forEach((match, index) => {
    const blockLabel = `${fileLabel} (mermaid #${index + 1})`
    const lines = match[1]
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('%%'))

    if (lines.length === 0 || !mermaidHeaderPattern.test(lines[0])) {
      errors.push(`${blockLabel}: invalid or missing flowchart header`)
      return
    }

    const nodes = new Map()
    const edges = []

    for (let i = 1; i < lines.length; i += 1) {
      const line = lines[i]
      const nodeMatch = mermaidNodePattern.exec(line)
      if (nodeMatch) {
        nodes.set(nodeMatch[1], nodeMatch[2])
        continue
      }
      const edgeMatch = mermaidEdgePattern.exec(line)
      if (edgeMatch) {
        const [, fromId, fromShape, , toId, toShape] = edgeMatch
        if (fromShape) nodes.set(fromId, fromShape)
        if (toShape) nodes.set(toId, toShape)
        edges.push([fromId, toId])
        continue
      }
      errors.push(`${blockLabel}: invalid Mermaid statement '${line}'`)
    }

    if (edges.length === 0) {
      errors.push(`${blockLabel}: flowchart must contain at least one transition`)
      return
    }

    const outgoing = new Map()
    const incoming = new Map()
    for (const [fromId, toId] of edges) {
      if (!nodes.has(fromId)) errors.push(`${blockLabel}: transition references undefined node '${fromId}'`)
      if (!nodes.has(toId)) errors.push(`${blockLabel}: transition references undefined node '${toId}'`)
      if (!outgoing.has(fromId)) outgoing.set(fromId, [])
      outgoing.get(fromId).push(toId)
      incoming.set(toId, (incoming.get(toId) ?? 0) + 1)
    }

    for (const [nodeId, shape] of nodes) {
      const label = unwrapMermaidLabel(shape)
      if (/<[^>]+>/.test(label)) errors.push(`${blockLabel}: node '${nodeId}' contains disallowed HTML tags`)
      if (label.length > 110) errors.push(`${blockLabel}: node '${nodeId}' label exceeds 110 chars (${label.length})`)
      if (shape.startsWith('{"') && (outgoing.get(nodeId)?.length ?? 0) < 2) {
        errors.push(`${blockLabel}: decision node '${nodeId}' must have at least 2 outgoing branches`)
      }
    }

    const entryNode = nodes.keys().next().value
    const visited = new Set()
    const queue = entryNode ? [entryNode] : []
    while (queue.length > 0) {
      const current = queue.shift()
      if (!current || visited.has(current)) continue
      visited.add(current)
      for (const next of outgoing.get(current) ?? []) {
        if (!visited.has(next)) queue.push(next)
      }
    }
    for (const nodeId of nodes.keys()) {
      if (!visited.has(nodeId)) errors.push(`${blockLabel}: unreachable or isolated node '${nodeId}'`)
    }
  })
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
    validateMermaidBlocks(content, displayPath(filePath, docsRoot), errors)
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
