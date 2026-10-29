import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const electronRoot = path.join(root, 'electron')
const offenders = []
const registered = new Set()

function channelName(node, constants) {
  if (ts.isStringLiteral(node)) return node.text
  if (ts.isIdentifier(node)) return constants.get(node.text)
  return undefined
}

function visitDirectory(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      visitDirectory(fullPath)
      continue
    }
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts') || entry.name === 'secureIpcMain.ts') continue
    const source = ts.createSourceFile(fullPath, fs.readFileSync(fullPath, 'utf8'), ts.ScriptTarget.Latest, true)
    const directNames = new Set()
    const constants = new Map()
    for (const statement of source.statements) {
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) && declaration.initializer && ts.isStringLiteral(declaration.initializer)) {
            constants.set(declaration.name.text, declaration.initializer.text)
          }
        }
      }
      if (!ts.isImportDeclaration(statement) || statement.moduleSpecifier.text !== 'electron') continue
      for (const specifier of statement.importClause?.namedBindings?.elements || []) {
        if ((specifier.propertyName || specifier.name).text === 'ipcMain') directNames.add(specifier.name.text)
      }
    }
    const visit = (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        ['handle', 'on'].includes(node.expression.name.text)
      ) {
        const position = source.getLineAndCharacterOfPosition(node.getStart(source))
        const location = `${path.relative(root, fullPath)}:${position.line + 1}`
        if (directNames.has(node.expression.expression.text)) offenders.push(location)
        if (node.expression.expression.text === 'ipcMain') {
          const channel = node.arguments[0] && channelName(node.arguments[0], constants)
          if (channel) registered.add(channel)
          else offenders.push(`Unresolved IPC channel at ${location}`)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
}

visitDirectory(electronRoot)
const schemaSource = ts.createSourceFile(
  'secureIpcMain.ts',
  fs.readFileSync(path.join(electronRoot, 'core/presentation/secureIpcMain.ts'), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
)
const schemas = new Set()
for (const statement of schemaSource.statements) {
  if (!ts.isVariableStatement(statement)) continue
  for (const declaration of statement.declarationList.declarations) {
    if (
      !ts.isIdentifier(declaration.name) ||
      declaration.name.text !== 'payloadSchemas' ||
      !declaration.initializer ||
      !ts.isObjectLiteralExpression(declaration.initializer)
    )
      continue
    for (const property of declaration.initializer.properties) {
      if (ts.isPropertyAssignment(property) && ts.isStringLiteral(property.name)) schemas.add(property.name.text)
    }
  }
}
for (const channel of registered) if (!schemas.has(channel)) offenders.push(`Missing payload schema: ${channel}`)
for (const channel of schemas) if (!registered.has(channel)) offenders.push(`Unregistered payload schema: ${channel}`)
if (offenders.length) {
  console.error(`IPC registration contract failed: ${offenders.join(', ')}`)
  process.exit(1)
}
console.log(`IPC registration guard: ${registered.size} handlers use secureIpcMain with matching schemas.`)
