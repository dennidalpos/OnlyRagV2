import { describe, it, expect } from 'vitest'
import { parseAgentToolCall } from './toolParser'

describe('Agent Tool Parser Domain Unit Tests', () => {
  it('should parse tool call enclosed in ```json block', () => {
    const raw = `Here is my recommendation:
\`\`\`json
{
  "tool": "read_file",
  "parameters": {
    "filePath": "src/App.tsx"
  },
  "explanation": "Inspecting App component"
}
\`\`\``

    const result = parseAgentToolCall(raw)
    expect(result).not.toBeNull()
    expect(result?.tool).toBe('read_file')
    expect(result?.parameters.filePath).toBe('src/App.tsx')
    expect(result?.explanation).toBe('Inspecting App component')
  })

  it('should parse tool call enclosed in <tool_call> tags', () => {
    const raw = `<tool_call>
{
  "tool": "run_command",
  "parameters": {
    "command": "npm run typecheck"
  }
}
</tool_call>`

    const result = parseAgentToolCall(raw)
    expect(result).not.toBeNull()
    expect(result?.tool).toBe('run_command')
    expect(result?.parameters.command).toBe('npm run typecheck')
  })

  it('should normalize tool name and parameter aliases correctly', () => {
    const raw = `\`\`\`json
{
  "tool": "edit_file",
  "params": {
    "file": "src/components/Test.tsx",
    "old_str": "const a = 1",
    "new_str": "const a = 2"
  }
}
\`\`\``

    const result = parseAgentToolCall(raw)
    expect(result).not.toBeNull()
    expect(result?.tool).toBe('replace_file_content')
    expect(result?.parameters.filePath).toBe('src/components/Test.tsx')
    expect(result?.parameters.targetContent).toBe('const a = 1')
    expect(result?.parameters.replacementContent).toBe('const a = 2')
  })

  it('should handle single-quoted keys and unescaped newlines in JSON values gracefully', () => {
    const raw = `\`\`\`json
{
  'tool': 'write_file',
  'parameters': {
    'filePath': 'src/newFile.ts',
    'content': "const x = 10;
const y = 20;"
  },
}
\`\`\``

    const result = parseAgentToolCall(raw)
    expect(result).not.toBeNull()
    expect(result?.tool).toBe('write_file')
    expect(result?.parameters.filePath).toBe('src/newFile.ts')
    expect(result?.parameters.content).toContain('const x = 10;')
  })

  it('should reject invalid tool calls missing mandatory input parameters', () => {
    const rawNoPath = `\`\`\`json
{
  "tool": "read_file",
  "parameters": {}
}
\`\`\``
    expect(parseAgentToolCall(rawNoPath)).toBeNull()

    const rawNoCmd = `\`\`\`json
{
  "tool": "run_command",
  "parameters": {}
}
\`\`\``
    expect(parseAgentToolCall(rawNoCmd)).toBeNull()
  })

  it('should parse multi_replace_file_content with chunks correctly', () => {
    const raw = `\`\`\`json
{
  "tool": "multi_replace",
  "parameters": {
    "filePath": "src/App.tsx",
    "chunks": [
      { "targetContent": "const a = 1", "replacementContent": "const a = 10" },
      { "targetContent": "const b = 2", "replacementContent": "const b = 20" }
    ]
  }
}
\`\`\``
    const result = parseAgentToolCall(raw)
    expect(result).not.toBeNull()
    expect(result?.tool).toBe('multi_replace_file_content')
    expect(result?.parameters.filePath).toBe('src/App.tsx')
    expect(result?.parameters.replacements?.length).toBe(2)
    expect(result?.parameters.replacements?.[0].targetContent).toBe('const a = 1')
  })

  it('should parse delete_file tool call and aliases', () => {
    const raw = `\`\`\`json
{
  "tool": "remove_file",
  "parameters": {
    "file": "temp/test.tmp"
  },
  "explanation": "Cleaning up temporary file"
}
\`\`\``
    const result = parseAgentToolCall(raw)
    expect(result).not.toBeNull()
    expect(result?.tool).toBe('delete_file')
    expect(result?.parameters.filePath).toBe('temp/test.tmp')
    expect(result?.explanation).toBe('Cleaning up temporary file')
  })

  it('should parse read_file with startLine and endLine slice parameters', () => {
    const raw = `\`\`\`json
{
  "tool": "view_file_slice",
  "parameters": {
    "filePath": "src/main.ts",
    "start_line": 10,
    "end_line": 35
  }
}
\`\`\``
    const result = parseAgentToolCall(raw)
    expect(result).not.toBeNull()
    expect(result?.tool).toBe('read_file')
    expect(result?.parameters.filePath).toBe('src/main.ts')
    expect(result?.parameters.startLine).toBe(10)
    expect(result?.parameters.endLine).toBe(35)
  })

  it('should parse web_search tool call and aliases', () => {
    const raw = `\`\`\`json
{
  "tool": "search_web",
  "parameters": {
    "query": "React 19 useActionState documentation"
  },
  "explanation": "Searching official React documentation"
}
\`\`\``
    const result = parseAgentToolCall(raw)
    expect(result).not.toBeNull()
    expect(result?.tool).toBe('web_search')
    expect(result?.parameters.query).toBe('React 19 useActionState documentation')
  })

  it('should parse fetch_web_content tool call and aliases', () => {
    const raw = `\`\`\`json
{
  "tool": "fetch_url",
  "parameters": {
    "url": "https://react.dev/reference/react/useActionState"
  },
  "explanation": "Fetching hook reference"
}
\`\`\``
    const result = parseAgentToolCall(raw)
    expect(result).not.toBeNull()
    expect(result?.tool).toBe('fetch_web_content')
    expect(result?.parameters.url).toBe('https://react.dev/reference/react/useActionState')
  })

  it('should parse download_file tool call and destination aliases', () => {
    const raw = `\`\`\`json
{
  "tool": "download_file",
  "parameters": {
    "url": "https://raw.githubusercontent.com/example/schema.json",
    "destination": "src/schemas/schema.json"
  }
}
\`\`\``
    const result = parseAgentToolCall(raw)
    expect(result).not.toBeNull()
    expect(result?.tool).toBe('download_file')
    expect(result?.parameters.url).toBe('https://raw.githubusercontent.com/example/schema.json')
    expect(result?.parameters.filePath).toBe('src/schemas/schema.json')
  })

  it('should parse tool call with unescaped Windows path backslashes and thought tags', () => {
    const raw = `<thought>I will inspect the App component on Windows</thought>
\`\`\`json
{
  "tool": "read_file",
  "parameters": {
    "filePath": "src\\components\\App.tsx"
  }
}
\`\`\``
    const result = parseAgentToolCall(raw)
    expect(result).not.toBeNull()
    expect(result?.tool).toBe('read_file')
    expect(result?.parameters.filePath).toBe('src\\components\\App.tsx')
  })

  it('should parse tool call from DeepSeek-R1 reasoning models with <think>...</think> blocks', () => {
    const raw = `<think>
Let's analyze the problem. The user wants to inspect src/main.ts.
I should call the read_file tool.
</think>
<tool_call>
{
  "tool": "read_file",
  "parameters": {
    "filePath": "src/main.ts"
  },
  "explanation": "Reading main entrypoint"
}
</tool_call>`
    const result = parseAgentToolCall(raw)
    expect(result).not.toBeNull()
    expect(result?.tool).toBe('read_file')
    expect(result?.parameters.filePath).toBe('src/main.ts')
    expect(result?.explanation).toBe('Reading main entrypoint')
  })

  it('should ignore example code blocks inside <think> and parse real tool call outside', () => {
    const raw = `<think>
Here is an example of what I could do:
\`\`\`json
{
  "tool": "unrelated_sample",
  "parameters": {}
}
\`\`\`
Now I will actually read the App file.
</think>
<tool_call>
{
  "tool": "read_file",
  "parameters": {
    "filePath": "src/App.tsx"
  }
}
</tool_call>`
    const result = parseAgentToolCall(raw)
    expect(result).not.toBeNull()
    expect(result?.tool).toBe('read_file')
    expect(result?.parameters.filePath).toBe('src/App.tsx')
  })

  it('should fallback to parsing tool call inside <think> when none exists outside', () => {
    const raw = `<think>
I need to write index.html:
\`\`\`json
{
  "tool": "write_file",
  "parameters": {
    "filePath": "index.html",
    "content": "<!DOCTYPE html><html><body>Canvas App</body></html>"
  },
  "explanation": "Creating main canvas HTML file"
}
\`\`\`
</think>`
    const result = parseAgentToolCall(raw)
    expect(result).not.toBeNull()
    expect(result?.tool).toBe('write_file')
    expect(result?.parameters.filePath).toBe('index.html')
    expect(result?.parameters.content).toContain('Canvas App')
  })

  it('should parse markdown code block with HTML filename comment as write_file tool call', () => {
    const raw = `I will create the HTML file now:
\`\`\`html
<!-- index.html -->
<!DOCTYPE html>
<html>
<head><title>Test App</title></head>
<body><h1>Hello World</h1></body>
</html>
\`\`\``
    const result = parseAgentToolCall(raw)
    expect(result).not.toBeNull()
    expect(result?.tool).toBe('write_file')
    expect(result?.parameters.filePath).toBe('index.html')
    expect(result?.parameters.content).toContain('Test App')
  })

  it('should parse markdown code block with JS filename comment as write_file tool call', () => {
    const raw = `Here is the JavaScript code:
\`\`\`javascript
// src/app.js
console.log("App initialized");
\`\`\``
    const result = parseAgentToolCall(raw)
    expect(result).not.toBeNull()
    expect(result?.tool).toBe('write_file')
    expect(result?.parameters.filePath).toBe('src/app.js')
    expect(result?.parameters.content).toContain('App initialized')
  })

  it('should return null when text does not contain valid tool call', () => {
    const raw = 'Just a normal text response without any tool invocations.'
    const result = parseAgentToolCall(raw)
    expect(result).toBeNull()
  })
})
