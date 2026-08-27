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

export function validateDocumentation({ docsRoot, packageJsonPath }) {
  const errors = []
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
  const scripts = new Set(Object.keys(packageJson.scripts ?? {}))
  const files = markdownFiles(docsRoot)
  const linkPattern = /\[[^\]]*\]\(([^)]+)\)/g
  const npmRunPattern = /\bnpm\s+run\s+([A-Za-z0-9:_-]+)/g

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8')
    for (const match of content.matchAll(linkPattern)) {
      const target = localLinkTarget(match[1])
      if (!target) continue
      const resolved = path.resolve(path.dirname(filePath), target)
      if (!fs.existsSync(resolved)) errors.push(`${displayPath(filePath, docsRoot)}: broken local link '${target}'`)
    }
    for (const match of content.matchAll(npmRunPattern)) {
      const scriptName = match[1]
      if (!scripts.has(scriptName)) errors.push(`${displayPath(filePath, docsRoot)}: undocumented npm script '${scriptName}' does not exist in package.json`)
    }
  }

  return { filesChecked: files.length, errors }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = validateDocumentation({
    docsRoot: path.resolve(process.argv[2] ?? path.join(repositoryRoot, 'docs')),
    packageJsonPath: path.resolve(process.argv[3] ?? path.join(repositoryRoot, 'package.json')),
  })
  if (result.errors.length > 0) {
    console.error(`Documentation validation failed with ${result.errors.length} error(s):`)
    for (const error of result.errors) console.error(`- ${error}`)
    process.exitCode = 1
  } else console.log(`Documentation validation passed: ${result.filesChecked} Markdown file(s) checked.`)
}
