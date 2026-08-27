import { describe, expect, it } from 'vitest'
import {
  OLLAMA_TOOL_SCHEMA_CATALOG,
  buildToolSchemaCorrectionDirective,
  findToolSchema,
} from './ollamaToolSchemaCatalog'

describe('findToolSchema', () => {
  it('returns the entry for a known tool and nothing for an unknown one', () => {
    expect(findToolSchema('write_file')?.function.name).toBe('write_file')
    expect(findToolSchema('validate_visual_artifact')?.function.name).toBe('validate_visual_artifact')
    expect(findToolSchema('teleport_file')).toBeUndefined()
  })
})

describe('buildToolSchemaCorrectionDirective', () => {
  it('names the tool, the reason, the mandatory parameters and the exact shape to emit', () => {
    // Replaces "mandatory input parameters were missing or malformed. Please ensure you
    // provide valid JSON with all required parameters" — which named none of these.
    const directive = buildToolSchemaCorrectionDirective('write_file', [
      "Missing required parameter 'filePath' for write_file",
    ])

    expect(directive).toContain('write_file')
    expect(directive).toContain("Missing required parameter 'filePath'")
    expect(directive).toContain('Mandatory parameters:')
    expect(directive).toContain('"filePath"')
    expect(directive).toContain('"tool": "write_file"')
    expect(directive).toContain('```json')
  })

  it('separates optional parameters from mandatory ones', () => {
    const directive = buildToolSchemaCorrectionDirective('read_file', ['bad params'])
    expect(directive).toContain('Mandatory parameters:')
    expect(directive).toContain('Optional parameters:')
    expect(directive).toContain('startLine')
  })

  it('lists the real tool names when the model invented one', () => {
    const directive = buildToolSchemaCorrectionDirective('teleport_file', ['unknown tool'])
    expect(directive).toContain('UNKNOWN TOOL "teleport_file"')
    expect(directive).toContain('write_file')
    expect(directive).toContain('read_file')
  })

  it('still produces a usable directive when no error text was supplied', () => {
    const directive = buildToolSchemaCorrectionDirective('run_command')
    expect(directive).toContain('run_command')
    expect(directive).toContain('"command"')
  })

  it('produces a directive for every tool in the catalogue', () => {
    for (const entry of OLLAMA_TOOL_SCHEMA_CATALOG) {
      const directive = buildToolSchemaCorrectionDirective(entry.function.name, ['x'])
      expect(directive, entry.function.name).toContain(entry.function.name)
      expect(directive, entry.function.name).toContain('```json')
    }
  })
})
