import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const coreRoot = path.join(root, 'electron', 'core')
const forbiddenPlatformModules = new Set(['electron', 'fs', 'node:fs', 'fs/promises', 'node:fs/promises'])
const domainForbiddenLayers = ['application', 'infrastructure', 'presentation'].map((layer) => path.join(coreRoot, layer) + path.sep)
// Host probes reach Application through HardwareProbePort (infrastructure/diagnostics/hardwareProbe.ts).
const applicationForbiddenModules = [path.join(root, 'electron', 'diagnostics')]
const offenders = []

function moduleSpecifiers(source) {
  const specifiers = []
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text)
    } else if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isStringLiteralLike(node.arguments[0])) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require'
      if (isDynamicImport || isRequire) specifiers.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return specifiers
}

function checkLayer(layer) {
  const layerRoot = path.join(coreRoot, layer)
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        walk(fullPath)
        continue
      }
      if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue
      const source = ts.createSourceFile(fullPath, fs.readFileSync(fullPath, 'utf8'), ts.ScriptTarget.Latest, true)
      const relativeFile = path.relative(root, fullPath).replace(/\\/g, '/')
      for (const specifier of moduleSpecifiers(source)) {
        if (forbiddenPlatformModules.has(specifier)) {
          offenders.push(`${relativeFile}: imports '${specifier}' (use a port in domain/ports or a repository in infrastructure)`)
        } else if (layer === 'application' && specifier.startsWith('.')) {
          const resolved = path.resolve(path.dirname(fullPath), specifier).replace(/\.ts$/, '')
          if (applicationForbiddenModules.includes(resolved)) {
            offenders.push(`${relativeFile}: imports '${specifier}' directly (use HardwareProbePort from domain/ports)`)
          }
        } else if (layer === 'domain' && specifier.startsWith('.')) {
          const resolved = path.resolve(path.dirname(fullPath), specifier)
          if (domainForbiddenLayers.some((forbidden) => resolved.startsWith(forbidden))) {
            offenders.push(`${relativeFile}: domain imports '${specifier}' from an outer layer`)
          }
        }
      }
    }
  }
  walk(layerRoot)
}

checkLayer('application')
checkLayer('domain')

if (offenders.length > 0) {
  console.error('Layering guard failed:')
  for (const offender of offenders) console.error(`  - ${offender}`)
  process.exit(1)
}
console.log(
  'Layering guard: application and domain use no Electron or filesystem modules; application reaches host probes only through HardwareProbePort; domain imports no outer layer.',
)
