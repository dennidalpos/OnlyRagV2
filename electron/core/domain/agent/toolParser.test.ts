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

  it('should parse create_directory, copy_file, move_file, and list_files_recursive aliases correctly', () => {
    const rawMkdir = `\`\`\`json
{
  "tool": "mkdir",
  "parameters": { "path": "src/components/ui" }
}
\`\`\``
    const resMkdir = parseAgentToolCall(rawMkdir)
    expect(resMkdir?.tool).toBe('create_directory')
    expect(resMkdir?.parameters.dirPath).toBe('src/components/ui')

    const rawCopy = `\`\`\`json
{
  "tool": "cp",
  "parameters": { "source": "src/App.tsx", "destination": "src/App.backup.tsx" }
}
\`\`\``
    const resCopy = parseAgentToolCall(rawCopy)
    expect(resCopy?.tool).toBe('copy_file')
    expect(resCopy?.parameters.sourcePath).toBe('src/App.tsx')
    expect(resCopy?.parameters.targetPath).toBe('src/App.backup.tsx')

    const rawMove = `\`\`\`json
{
  "tool": "mv",
  "parameters": { "src": "src/App.tsx", "dest": "src/components/App.tsx" }
}
\`\`\``
    const resMove = parseAgentToolCall(rawMove)
    expect(resMove?.tool).toBe('move_file')
    expect(resMove?.parameters.sourcePath).toBe('src/App.tsx')
    expect(resMove?.parameters.targetPath).toBe('src/components/App.tsx')

    const rawTree = `\`\`\`json
{
  "tool": "tree",
  "parameters": { "path": "src", "maxDepth": 4 }
}
\`\`\``
    const resTree = parseAgentToolCall(rawTree)
    expect(resTree?.tool).toBe('list_files_recursive')
    expect(resTree?.parameters.dirPath).toBe('src')
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

  it('should ignore tool call blocks enclosed completely within <think> tags to avoid accidental execution of hypothetical examples', () => {
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
    expect(result).toBeNull()
  })

  it('should ignore truncated unclosed <think> blocks at end of generation', () => {
    const raw = `<think>
I am considering writing a file:
\`\`\`json
{
  "tool": "write_file",
  "parameters": {
    "filePath": "unfinished.txt",
    "content": "sample"
  }
}
\`\`\`
and continuing reasoning...`
    const result = parseAgentToolCall(raw)
    expect(result).toBeNull()
  })

  it('should safely parse tool call after thought blocks or unclosed thought blocks', () => {
    const raw = `<thought>
Internal reasoning step
</thought>
\`\`\`json
{
  "tool": "list_dir",
  "parameters": {
    "dirPath": "src"
  }
}
\`\`\``
    const result = parseAgentToolCall(raw)
    expect(result).not.toBeNull()
    expect(result?.tool).toBe('list_dir')
    expect(result?.parameters.dirPath).toBe('src')
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

  it('should parse ask tool call and prompt user aliases correctly', () => {
    const raw = `\`\`\`json
{
  "tool": "ask",
  "parameters": {
    "question": "Quale framework UI preferisci usare?"
  },
  "explanation": "Chiedo chiarimento all'utente"
}
\`\`\``
    const result = parseAgentToolCall(raw)
    expect(result).not.toBeNull()
    expect(result?.tool).toBe('ask')
    expect(result?.parameters.question).toBe('Quale framework UI preferisci usare?')
    expect(result?.explanation).toBe("Chiedo chiarimento all'utente")
  })

  it('should parse ask_question alias with query/prompt fallback', () => {
    const raw = `\`\`\`json
{
  "tool": "ask_question",
  "parameters": {
    "query": "Vuoi procedere con l'installazione?"
  }
}
\`\`\``
    const result = parseAgentToolCall(raw)
    expect(result).not.toBeNull()
    expect(result?.tool).toBe('ask')
    expect(result?.parameters.question).toBe("Vuoi procedere con l'installazione?")
  })

  it('should parse download_file tool call correctly', () => {
    const raw = `\`\`\`json
{
  "tool": "download_file",
  "parameters": {
    "url": "https://example.com/assets/logo.png",
    "filePath": "src/assets/logo.png"
  }
}
\`\`\``
    const result = parseAgentToolCall(raw)
    expect(result).not.toBeNull()
    expect(result?.tool).toBe('download_file')
    expect(result?.parameters.url).toBe('https://example.com/assets/logo.png')
    expect(result?.parameters.filePath).toBe('src/assets/logo.png')
  })

  it('should parse extended tool aliases (run_cmd, write_code, replace_file, find_text, read_url_content)', () => {
    const rawRunCmd = '```json\n{"tool": "run_cmd", "parameters": {"command": "git status"}}\n```'
    expect(parseAgentToolCall(rawRunCmd)?.tool).toBe('run_command')

    const rawWriteCode = '```json\n{"tool": "write_code", "parameters": {"filePath": "index.ts", "content": "console.log(1)"}}\n```'
    expect(parseAgentToolCall(rawWriteCode)?.tool).toBe('write_file')

    const rawReplaceFile = '```json\n{"tool": "replace_file", "parameters": {"filePath": "index.ts", "targetContent": "1", "replacementContent": "2"}}\n```'
    expect(parseAgentToolCall(rawReplaceFile)?.tool).toBe('replace_file_content')

    const rawFindText = '```json\n{"tool": "find_text", "parameters": {"query": "useTranslation"}}\n```'
    expect(parseAgentToolCall(rawFindText)?.tool).toBe('grep_search')

    const rawReadUrl = '```json\n{"tool": "read_url_content", "parameters": {"url": "https://example.com"}}\n```'
    expect(parseAgentToolCall(rawReadUrl)?.tool).toBe('fetch_web_content')
  })

  it('should parse tool calls with JS backtick template literals in content parameter', () => {
    const raw = '```json\n{\n  "tool": "write_file",\n  "parameters": {\n    "filePath": "src/App.tsx",\n    "content": `import React from "react";\nimport Dashboard from "./components/Dashboard";\n\nfunction App() {\n  return <Dashboard />;\n}\n\nexport default App;\n`\n  },\n  "explanation": "Creating initial App.tsx file"\n}\n```'
    const result = parseAgentToolCall(raw)
    expect(result).not.toBeNull()
    expect(result?.tool).toBe('write_file')
    expect(result?.parameters.filePath).toBe('src/App.tsx')
    expect(result?.parameters.content).toContain('import React from "react"')
    expect(result?.explanation).toBe('Creating initial App.tsx file')
  })

  it('should parse Windows single-backslash file paths without corrupting escape characters', () => {
    const raw = '```json\n{\n  "tool": "write_file",\n  "parameters": {\n    "filePath": "C:\\Users\\Utente\\Desktop\\test_app\\project-dashboard-task\\src\\App.tsx",\n    "content": "export const test = 1;"\n  }\n}\n```'
    const result = parseAgentToolCall(raw)
    expect(result).not.toBeNull()
    expect(result?.tool).toBe('write_file')
    expect(result?.parameters.filePath).toContain('test_app')
    expect(result?.parameters.filePath).toContain('App.tsx')
  })

  it('should parse tool calls with flat parameters at root level without nested parameters object', () => {
    const raw = '```json\n{\n  "tool": "write_file",\n  "filePath": "C:\\\\Users\\\\Utente\\\\Desktop\\\\test_app\\\\project-dashboard-task\\\\src\\\\App.tsx",\n  "content": "// Import necessary libraries\\nimport React from \'react\';\\nexport default App;"\n}\n```'
    const result = parseAgentToolCall(raw)
    expect(result).not.toBeNull()
    expect(result?.tool).toBe('write_file')
    expect(result?.parameters.filePath).toContain('App.tsx')
    expect(result?.parameters.content).toContain("import React from 'react'")
  })

  it('should parse flat run_command and replace_file_content at root level', () => {
    const rawCmd = '```json\n{\n  "tool": "run_command",\n  "command": "npm install tailwindcss",\n  "explanation": "Installing tailwind"\n}\n```'
    const resCmd = parseAgentToolCall(rawCmd)
    expect(resCmd).not.toBeNull()
    expect(resCmd?.tool).toBe('run_command')
    expect(resCmd?.parameters.command).toBe('npm install tailwindcss')
    expect(resCmd?.explanation).toBe('Installing tailwind')

    const rawReplace = '```json\n{\n  "tool": "replace_file_content",\n  "filePath": "package.json",\n  "targetContent": "\\"scripts\\": {}",\n  "replacementContent": "\\"scripts\\": {\\"start\\": \\"vite\\"}"\n}\n```'
    const resReplace = parseAgentToolCall(rawReplace)
    expect(resReplace).not.toBeNull()
    expect(resReplace?.tool).toBe('replace_file_content')
    expect(resReplace?.parameters.filePath).toBe('package.json')
  })

  it('should parse the OpenAI/native-tool-calling {"name","arguments"} shape (captured live from qwen2.5-coder via Ollama /api/chat with tools, which echoes the call as plain-text JSON instead of populating message.tool_calls)', () => {
    const raw = '{"name": "read_file", "arguments": {"filePath": "app.py"}}'
    const result = parseAgentToolCall(raw)
    expect(result).not.toBeNull()
    expect(result?.tool).toBe('read_file')
    expect(result?.parameters.filePath).toBe('app.py')
  })

  it('should parse a fenced {"name","arguments"} tool call and normalize aliased tool names', () => {
    const raw = '```json\n{"name": "writefile", "arguments": {"filePath": "src/App.tsx", "content": "export default App;"}}\n```'
    const result = parseAgentToolCall(raw)
    expect(result).not.toBeNull()
    expect(result?.tool).toBe('write_file')
    expect(result?.parameters.filePath).toBe('src/App.tsx')
    expect(result?.parameters.content).toContain('export default App')
  })

  it('should auto-repair run_command when parameters or command is passed as an array of strings', () => {
    const rawArrayParams = `\`\`\`json
{
  "tool": "run_command",
  "parameters": [
    "npm create vite@latest . --template react-ts --yes",
    "yarn add @tailwindcss/forms",
    "yarn add react-scroll-tree"
  ],
  "explanation": "Installing project dependencies"
}
\`\`\``
    const resArrayParams = parseAgentToolCall(rawArrayParams)
    expect(resArrayParams).not.toBeNull()
    expect(resArrayParams?.tool).toBe('run_command')
    expect(resArrayParams?.parameters.command).toBe(
      'npm create vite@latest . --template react-ts --yes; yarn add @tailwindcss/forms; yarn add react-scroll-tree'
    )

    const rawArrayCommand = `\`\`\`json
{
  "tool": "run_command",
  "parameters": {
    "command": ["npm install", "npm run build"]
  }
}
\`\`\``
    const resArrayCommand = parseAgentToolCall(rawArrayCommand)
    expect(resArrayCommand).not.toBeNull()
    expect(resArrayCommand?.tool).toBe('run_command')
    expect(resArrayCommand?.parameters.command).toBe('npm install; npm run build')
  })

  it('should parse raw markdown bash blocks into run_command tool calls', () => {
    const raw = `Here is how you set up the application:
\`\`\`bash
npm create vite@latest . --template react-ts -y
npm install
\`\`\``
    const res = parseAgentToolCall(raw)
    expect(res).not.toBeNull()
    expect(res?.tool).toBe('run_command')
    expect(res?.parameters.command).toBe('npm create vite@latest . --template react-ts -y; npm install')
  })

  it('should parse Aider-style search/replace diff blocks into replace_file_content tool calls', () => {
    const raw = `Updating src/App.tsx:

src/App.tsx
<<<<<<< SEARCH
import React from 'react';
=======
import React, { useState } from 'react';
>>>>>>> REPLACE`
    const res = parseAgentToolCall(raw)
    expect(res).not.toBeNull()
    expect(res?.tool).toBe('replace_file_content')
    expect(res?.parameters.filePath).toBe('src/App.tsx')
    expect(res?.parameters.targetContent).toBe("import React from 'react';")
    expect(res?.parameters.replacementContent).toBe("import React, { useState } from 'react';")
  })

  it('should parse search/replace diff blocks with empty SEARCH section into write_file tool calls', () => {
    const raw = `Creating package.json:

package.json
<<<<<<< SEARCH
=======
{
  "name": "my-app",
  "version": "1.0.0"
}
>>>>>>> REPLACE`
    const res = parseAgentToolCall(raw)
    expect(res).not.toBeNull()
    expect(res?.tool).toBe('write_file')
    expect(res?.parameters.filePath).toBe('package.json')
    expect(res?.parameters.content).toContain('"name": "my-app"')
  })

  it('should auto-recover raw bash code blocks into run_command tool calls', () => {
    const raw = `Here is the terminal command:
\`\`\`bash
npm create vite@latest ./ -- --template react-ts
\`\`\``
    const result = parseAgentToolCall(raw)
    expect(result).not.toBeNull()
    expect(result?.tool).toBe('run_command')
    expect(result?.parameters.command).toBe('npm create vite@latest ./ -- --template react-ts')
  })

  it('should return null when text does not contain valid tool call', () => {
    const raw = 'Just a normal text response without any tool invocations.'
    const result = parseAgentToolCall(raw)
    expect(result).toBeNull()
  })
})

describe('parseAgentToolCall — several calls in one response', () => {
  // Reproduces step 86 of coding_agent_audit.log session-1787497654743-4enx verbatim: three
  // native-format calls separated by blank lines. The greedy first-brace-to-last-brace span
  // covered all three, parsed as nothing, and the turn was recorded as "no tool call" —
  // which, on an already exhausted noToolStreak, ended the session.
  const THREE_NATIVE_CALLS = `{"name": "write_file", "arguments": {"filePath": "src/components/Sidebar.tsx", "content": "import React from 'react';\n\nfunction Sidebar() {\n  return (\n    <nav className=\\"flex flex-col\\">\n      <button>Home</button>\n    </nav>\n  );\n}\n\nexport default Sidebar;"}}

{"name": "write_file", "arguments": {"filePath": "src/components/TaskCard.tsx", "content": "import React from 'react';\n\nfunction TaskCard() {\n  return <div />;\n}\n\nexport default TaskCard;"}}

{"name": "update_plan", "arguments": {"milestoneId": "m-11", "status": "verified"}}`

  it('executes the first call instead of discarding the whole turn', () => {
    const result = parseAgentToolCall(THREE_NATIVE_CALLS)
    expect(result).not.toBeNull()
    expect(result?.tool).toBe('write_file')
    expect(result?.parameters.filePath).toBe('src/components/Sidebar.tsx')
  })

  it('keeps the braces that belong to the file content out of the object boundary', () => {
    const result = parseAgentToolCall(THREE_NATIVE_CALLS)
    expect(result?.parameters.content).toContain('export default Sidebar;')
    expect(result?.parameters.content).not.toContain('TaskCard')
  })

  it('handles several calls stacked inside one json fence', () => {
    const raw = ['```json', '{"tool": "read_file", "parameters": {"filePath": "a.ts"}}', '{"tool": "read_file", "parameters": {"filePath": "b.ts"}}', '```'].join('\n')
    const result = parseAgentToolCall(raw)
    expect(result?.tool).toBe('read_file')
    expect(result?.parameters.filePath).toBe('a.ts')
  })

  it('still repairs a single truncated object through the greedy fallback', () => {
    const raw = '{"tool": "run_command", "parameters": {"command": "npm test"}'
    const result = parseAgentToolCall(raw)
    expect(result?.tool).toBe('run_command')
    expect(result?.parameters.command).toBe('npm test')
  })
})

describe('rejection diagnostics', () => {
  const FENCE = '```json'

  it('reports which tool was refused and why, instead of failing silently', () => {
    const rejections: { toolName: string; errors: string[] }[] = []
    const parsed = parseAgentToolCall(
      [FENCE, '{ "tool": "write_file", "parameters": { "content": "hello" } }', '```'].join('\n'),
      (r) => rejections.push(r)
    )

    expect(parsed).toBeNull()
    expect(rejections).toHaveLength(1)
    expect(rejections[0].toolName).toBe('write_file')
    expect(rejections[0].errors.join(' ')).toContain('filePath')
  })

  it('stays silent on a valid call', () => {
    const rejections: { toolName: string; errors: string[] }[] = []
    const parsed = parseAgentToolCall(
      [FENCE, '{ "tool": "read_file", "parameters": { "filePath": "src/App.tsx" } }', '```'].join('\n'),
      (r) => rejections.push(r)
    )

    expect(parsed?.tool).toBe('read_file')
    expect(rejections).toHaveLength(0)
  })

  it('works without a sink, as every existing caller does', () => {
    expect(parseAgentToolCall([FENCE, '{ "tool": "write_file", "parameters": {} }', '```'].join('\n'))).toBeNull()
  })
})
