/**
 * electron/core/domain/agent/ollamaToolSchemaCatalog.ts
 *
 * Domain Layer — Native Tool-Calling Schema Catalog
 *
 * Structured JSON-Schema tool definitions for all coding-agent tools, in the
 * OpenAI-compatible `tools` array format Ollama's POST /api/chat endpoint
 * expects. Parameter names and requiredness are derived directly from the
 * actual handlers in agentToolExecutorService.ts, so native tool-calling
 * requests stay in sync with what the executor accepts.
 *
 * "ask" and "finish" are orchestrator-level pseudo-tools (handled before
 * agentToolExecutorService's switch) and are included here too, since a
 * native-tool-calling model needs them in its tool list the same way the
 * prompt-engineered system prompt lists them today.
 */

export interface OllamaToolSchema {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, { type: string; description: string }>
      required: string[]
    }
  }
}

function tool(
  name: string,
  description: string,
  properties: Record<string, { type: string; description: string }>,
  required: string[] = []
): OllamaToolSchema {
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } }
}

export const OLLAMA_TOOL_SCHEMA_CATALOG: OllamaToolSchema[] = [
  tool('read_file', 'Read the contents of a file, optionally sliced by line range.', {
    filePath: { type: 'string', description: 'Path to the file to read.' },
    startLine: { type: 'integer', description: 'Optional 1-based start line.' },
    endLine: { type: 'integer', description: 'Optional 1-based end line.' },
  }, ['filePath']),
  tool('extract_code_symbols', 'Extract functions, classes, and interfaces declared in a source file.', {
    filePath: { type: 'string', description: 'Path to the source file.' },
    kind: { type: 'string', description: 'Optional symbol kind filter (function, class, interface).' },
  }, ['filePath']),
  tool('list_dir', 'List the immediate contents (files and directories) of a directory.', {
    dirPath: { type: 'string', description: 'Directory path to list.' },
  }, ['dirPath']),
  tool('list_files_recursive', 'Recursively list files and directories up to a depth limit.', {
    dirPath: { type: 'string', description: 'Root directory to walk.' },
    maxDepth: { type: 'integer', description: 'Maximum recursion depth (1-6, default 3).' },
  }, ['dirPath']),
  tool('grep_search', 'Search file contents in a directory for a text or regex pattern.', {
    query: { type: 'string', description: 'Search text or regex pattern.' },
    dirPath: { type: 'string', description: 'Directory to search within.' },
    isRegex: { type: 'boolean', description: 'Treat query as a regular expression.' },
    caseInsensitive: { type: 'boolean', description: 'Case-insensitive search (default true).' },
  }, ['query']),
  tool('web_search', 'Search the web for a query and return top results.', {
    query: { type: 'string', description: 'Search query.' },
    maxResults: { type: 'integer', description: 'Maximum number of results (default 8).' },
  }, ['query']),
  tool('fetch_web_content', 'Fetch and extract readable content from a web page URL.', {
    url: { type: 'string', description: 'URL of the page to fetch.' },
  }, ['url']),
  tool('write_file', 'Create a file or overwrite it entirely with new content.', {
    filePath: { type: 'string', description: 'Path of the file to write.' },
    content: { type: 'string', description: 'Full file content to write.' },
  }, ['filePath', 'content']),
  tool('create_directory', 'Create a directory, including any missing parent directories.', {
    dirPath: { type: 'string', description: 'Directory path to create.' },
  }, ['dirPath']),
  tool('copy_file', 'Copy a file from one path to another.', {
    sourcePath: { type: 'string', description: 'Path of the file to copy.' },
    targetPath: { type: 'string', description: 'Destination path for the copy.' },
  }, ['sourcePath', 'targetPath']),
  tool('move_file', 'Move or rename a file from one path to another.', {
    sourcePath: { type: 'string', description: 'Current path of the file.' },
    targetPath: { type: 'string', description: 'New path for the file.' },
  }, ['sourcePath', 'targetPath']),
  tool('replace_file_content', 'Replace a single exact chunk of text in a file with new content.', {
    filePath: { type: 'string', description: 'Path of the file to edit.' },
    targetContent: { type: 'string', description: 'Exact existing text chunk to find and replace.' },
    replacementContent: { type: 'string', description: 'New text to replace the target chunk with.' },
  }, ['filePath', 'targetContent', 'replacementContent']),
  tool('multi_replace_file_content', 'Apply multiple exact-chunk text replacements to a single file in one call.', {
    filePath: { type: 'string', description: 'Path of the file to edit.' },
    replacements: {
      type: 'array',
      description: 'List of {targetContent, replacementContent} chunk replacements to apply.',
    },
  }, ['filePath', 'replacements']),
  tool('delete_file', 'Delete a file from disk.', {
    filePath: { type: 'string', description: 'Path of the file to delete.' },
  }, ['filePath']),
  tool('download_file', 'Download a file from a URL to a local path.', {
    url: { type: 'string', description: 'URL to download from.' },
    filePath: { type: 'string', description: 'Local destination path.' },
  }, ['url', 'filePath']),
  tool('run_command', 'Execute a shell/terminal command in the workspace.', {
    command: { type: 'string', description: 'The shell command to execute.' },
  }, ['command']),
  tool('inspect_os_env', 'Inspect the host OS environment (platform, CPU, memory).', {}),
  tool('git_status', 'Show the working tree status (git status --short) of the workspace.', {}),
  tool('git_diff', 'Show the diff of unstaged or staged changes, optionally for a single file.', {
    filePath: { type: 'string', description: 'Optional single file to diff.' },
    staged: { type: 'boolean', description: 'Show staged changes instead of unstaged (default false).' },
  }),
  tool('rollback_workspace', 'Revert all file modifications made during this session back to their pre-session state.', {}),
  tool('get_file_info', 'Get metadata about a file: existence, size, line count, binary detection.', {
    filePath: { type: 'string', description: 'Path of the file to inspect.' },
  }, ['filePath']),
  tool('ask', 'Ask the user a clarifying question and pause execution for their answer.', {
    question: { type: 'string', description: 'The question to ask the user.' },
  }, ['question']),
  tool('finish', 'Signal that the task is complete and provide a final summary.', {
    summary: { type: 'string', description: 'Final summary of what was accomplished.' },
  }, ['summary']),
]
