import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execSync } from 'node:child_process'
import { agentToolExecutorService } from './agentToolExecutorService'
import type { AppSettings } from '../../../src/types'

describe('AgentToolExecutorService Unit Tests', () => {
  let tempDir: string
  const settings: AppSettings = {
    defaultModel: 'llama3.2',
    hardwareProfile: 'Auto',
    ocrEngine: 'native_cuda',
    ollamaHost: '',
    codingModel: 'llama3.2',
    translationModel: 'llama3.2',
    visionModel: 'llama3.2-vision',
    embeddingModel: 'nomic-embed-text',
    allowTerminalExecution: true,
    allowFileModifications: true,
    customPromptOverrides: {},
  }

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-executor-test-'))
  })

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })

  it('should execute write_file and read_file successfully', async () => {
    const filePath = path.join(tempDir, 'test.txt')
    const writeRes = await agentToolExecutorService.executeTool(
      {
        tool: 'write_file',
        parameters: { filePath, content: 'Hello AI Agent' },
      },
      tempDir,
      settings
    )

    expect(writeRes.outputForHistory).toContain('Successfully wrote file')
    expect(fs.existsSync(filePath)).toBe(true)

    const readRes = await agentToolExecutorService.executeTool(
      {
        tool: 'read_file',
        parameters: { filePath },
      },
      tempDir,
      settings
    )

    expect(readRes.outputForHistory).toContain('Hello AI Agent')
  })

  describe('reconcileHunkApproval', () => {
    it('should return the tool call unchanged when approvedHunkIndices is absent', () => {
      const tool = { tool: 'write_file' as const, parameters: { filePath: path.join(tempDir, 'x.txt'), content: 'new' } }
      expect(agentToolExecutorService.reconcileHunkApproval(tool, undefined, tempDir)).toBe(tool)
    })

    it('should return the tool call unchanged for non-file-mutation tools', () => {
      const tool = { tool: 'run_command' as const, parameters: { command: 'echo hi' } }
      expect(agentToolExecutorService.reconcileHunkApproval(tool, [0], tempDir)).toBe(tool)
    })

    it('should return the tool call unchanged (full accept) when every hunk is approved', () => {
      const filePath = path.join(tempDir, 'full-accept.txt')
      fs.writeFileSync(filePath, 'a\nb\nc', 'utf-8')
      const tool = { tool: 'write_file' as const, parameters: { filePath, content: 'a\nB\nC' } }
      // Both changed lines land in one contiguous hunk (id 0) since there's no context between them.
      expect(agentToolExecutorService.reconcileHunkApproval(tool, [0], tempDir)).toBe(tool)
    })

    it('should rewrite the tool call into a write_file carrying only the approved hunk when hunks are independent', () => {
      const filePath = path.join(tempDir, 'partial-accept.txt')
      fs.writeFileSync(filePath, 'line1\nline2\nline3\nline4\nline5', 'utf-8')
      const tool = {
        tool: 'write_file' as const,
        parameters: { filePath, content: 'line1\nCHANGED2\nline3\nline4\nCHANGED5' },
      }

      const reconciled = agentToolExecutorService.reconcileHunkApproval(tool, [0], tempDir)
      expect(reconciled.tool).toBe('write_file')
      expect(reconciled.parameters.content).toBe('line1\nCHANGED2\nline3\nline4\nline5')
    })

    it('should end-to-end write only the approved hunk\'s content to disk when the reconciled call is executed', async () => {
      const filePath = path.join(tempDir, 'partial-exec.txt')
      fs.writeFileSync(filePath, 'line1\nline2\nline3\nline4\nline5', 'utf-8')
      const tool = {
        tool: 'write_file' as const,
        parameters: { filePath, content: 'line1\nCHANGED2\nline3\nline4\nCHANGED5' },
      }

      const reconciled = agentToolExecutorService.reconcileHunkApproval(tool, [1], tempDir) // approve only the SECOND hunk this time
      await agentToolExecutorService.executeTool(reconciled, tempDir, settings)

      expect(fs.readFileSync(filePath, 'utf-8')).toBe('line1\nline2\nline3\nline4\nCHANGED5')
    })

    it('should convert a partially-rejected delete_file into a real write_file that only removed the approved lines', () => {
      const filePath = path.join(tempDir, 'partial-delete.txt')
      fs.writeFileSync(filePath, 'keep1\nDROP\nkeep2', 'utf-8')
      const tool = { tool: 'delete_file' as const, parameters: { filePath } }

      // A whole-file delete diff has no context lines, so it is exactly one all-or-nothing hunk;
      // approving it is a full accept and must keep delete_file's own semantics (a real delete).
      const fullAccept = agentToolExecutorService.reconcileHunkApproval(tool, [0], tempDir)
      expect(fullAccept).toBe(tool)

      const rejected = agentToolExecutorService.reconcileHunkApproval(tool, [], tempDir)
      expect(rejected.tool).toBe('write_file')
      expect(rejected.parameters.content).toBe('keep1\nDROP\nkeep2')
    })
  })

  it('should block write_file for a .json path with syntactically invalid JSON content via AST pre-commit validation', async () => {
    const filePath = path.join(tempDir, 'package.json')
    const res = await agentToolExecutorService.executeTool(
      {
        tool: 'write_file',
        // Malformed key (leading space) mirrors the real EJSONPARSE case this guard prevents.
        parameters: { filePath, content: '{\n  " browserslist": []\n' },
      },
      tempDir,
      settings
    )

    expect(res.outputForHistory).toContain('PRE-COMMIT AST VALIDATION ERROR')
    expect(res.outputForHistory).toContain('JSON Syntax Error')
    expect(res.logMessage).toContain('Write File Rejected (AST Syntax Error)')
    expect(fs.existsSync(filePath)).toBe(false)
  })

  it('should allow write_file for a .json path with valid JSON content', async () => {
    const filePath = path.join(tempDir, 'valid.json')
    const res = await agentToolExecutorService.executeTool(
      {
        tool: 'write_file',
        parameters: { filePath, content: '{"name": "onlyrag"}' },
      },
      tempDir,
      settings
    )

    expect(res.outputForHistory).toContain('Successfully wrote file')
    expect(fs.existsSync(filePath)).toBe(true)
  })

  it('should report a semantic TypeScript error immediately after write_file persists valid syntax', async () => {
    fs.mkdirSync(path.join(tempDir, 'src'))
    fs.writeFileSync(
      path.join(tempDir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, include: ['src'] }),
      'utf-8'
    )
    const filePath = path.join(tempDir, 'src', 'value.ts')

    const res = await agentToolExecutorService.executeTool(
      {
        tool: 'write_file',
        parameters: { filePath, content: 'const value: number = "wrong"\nexport { value }\n' },
      },
      tempDir,
      settings
    )

    expect(fs.existsSync(filePath)).toBe(true)
    expect(res.outputForHistory).toContain('Successfully wrote file')
    expect(res.outputForHistory).toContain('[POST-WRITE TYPECHECK DIAGNOSTIC]')
    expect(res.outputForHistory).toContain('TS2322')
    expect(res.outputForHistory).toContain('src/value.ts(1,7)')
  })

  it('should extract code symbols from TypeScript file', async () => {
    const filePath = path.join(tempDir, 'symbols.ts')
    const codeContent = `
export interface UserDTO {
  id: string;
  name: string;
}

export type UserRole = 'admin' | 'user';

export class UserService {
  getUser(): UserDTO {
    return { id: '1', name: 'Alice' };
  }
}

export async function fetchAllUsers(): Promise<UserDTO[]> {
  return [];
}

export const processUserData = async (data: UserDTO) => {
  return data;
};
`
    fs.writeFileSync(filePath, codeContent, 'utf-8')

    const res = await agentToolExecutorService.executeTool(
      {
        tool: 'extract_code_symbols',
        parameters: { filePath },
      },
      tempDir,
      settings
    )

    expect(res.outputForHistory).toContain('[CODE SYMBOLS:')
    expect(res.outputForHistory).toContain('[interface] UserDTO')
    expect(res.outputForHistory).toContain('[type] UserRole')
    expect(res.outputForHistory).toContain('[class] UserService')
    expect(res.outputForHistory).toContain('[function] fetchAllUsers')
    expect(res.outputForHistory).toContain('[function] processUserData')
  })

  it('should extract filtered code symbols from Python file', async () => {
    const pyPath = path.join(tempDir, 'models.py')
    const pyContent = `
class BaseModel:
    pass

class UserModel(BaseModel):
    def get_id(self):
        return 1

async def async_handler():
    return True
`
    fs.writeFileSync(pyPath, pyContent, 'utf-8')

    // Filter only classes
    const res = await agentToolExecutorService.executeTool(
      {
        tool: 'extract_code_symbols',
        parameters: { filePath: pyPath, symbolType: 'class' },
      },
      tempDir,
      settings
    )

    expect(res.outputForHistory).toContain('[class] BaseModel')
    expect(res.outputForHistory).toContain('[class] UserModel')
    expect(res.outputForHistory).not.toContain('[function] async_handler')
  })

  it('should execute replace_file_content and return auto-healing feedback if chunk is not found', async () => {
    const filePath = path.join(tempDir, 'replace.ts')
    fs.writeFileSync(filePath, 'const a = 1;\nconst b = 2;\n', 'utf-8')

    const successRes = await agentToolExecutorService.executeTool(
      {
        tool: 'replace_file_content',
        parameters: { filePath, targetContent: 'const a = 1;', replacementContent: 'const a = 100;' },
      },
      tempDir,
      settings
    )

    expect(successRes.outputForHistory).toContain('Successfully replaced content')

    const failRes = await agentToolExecutorService.executeTool(
      {
        tool: 'replace_file_content',
        parameters: { filePath, targetContent: 'non_existent_code_chunk', replacementContent: 'const x = 0;' },
      },
      tempDir,
      settings
    )

    expect(failRes.outputForHistory).toContain('[REPLACE FILE ERROR')
  })

  it('should block destructive shell commands via command security guardrail', async () => {
    const res = await agentToolExecutorService.executeTool(
      {
        tool: 'run_command',
        parameters: { command: 'git reset --hard HEAD' },
      },
      tempDir,
      settings
    )

    expect(res.outputForHistory).toContain('[SECURITY GUARDRAIL BLOCK]')
    expect(res.logMessage).toContain('[SECURITY BLOCK]')
  })

  it('gives the model the failure reason even when the command also printed to stdout', async () => {
    // The end-to-end shape of every failing `npm run build` in session-1787562597025-q8a5: a
    // banner on stdout, the actual cause on stderr. The executor used to hand the model
    // whichever single stream was non-empty, so the auto-healing block arrived carrying the
    // banner and an exit code, under a directive to inspect a stack trace it had discarded.
    // The markers live in a script file, never in the command string: the diagnostics block
    // echoes the command back, so an inline `node -e "...CAUSE_LINE..."` would satisfy the
    // assertion from the echo alone and pass against the very bug it is meant to catch.
    fs.writeFileSync(
      path.join(tempDir, 'fail.js'),
      "console.log('BANNER_LINE'); console.error('CAUSE_LINE'); process.exit(1);",
      'utf-8'
    )

    const res = await agentToolExecutorService.executeTool(
      { tool: 'run_command', parameters: { command: 'node fail.js', timeoutSeconds: 30 } },
      tempDir,
      settings
    )

    expect(res.outputForHistory).toContain('[TERMINAL AUTO-HEALING DIAGNOSTICS LOG]')
    expect(res.outputForHistory).toContain('BANNER_LINE')
    expect(res.outputForHistory).toContain('CAUSE_LINE')
  })

  describe('write_file target shape', () => {
    it('creates a real directory when the path ends with a separator and no content is given', () => {
      // `write_file("src/services/", "")` used to answer "Successfully wrote file src/services/"
      // after creating a zero-byte FILE named services — session-1787562597025-q8a5, m-7.
      return agentToolExecutorService
        .executeTool({ tool: 'write_file', parameters: { filePath: 'src/services/', content: '' } }, tempDir, settings)
        .then((res) => {
          expect(res.outputForHistory).toContain('Created DIRECTORY')
          expect(fs.statSync(path.join(tempDir, 'src', 'services')).isDirectory()).toBe(true)
        })
    })

    it('refuses a separator-terminated path that also carries content', async () => {
      const res = await agentToolExecutorService.executeTool(
        { tool: 'write_file', parameters: { filePath: 'src/services/', content: 'export const api = 1' } },
        tempDir,
        settings
      )

      expect(res.outputForHistory).toContain('[WRITE_FILE REJECTED: PATH IS A DIRECTORY]')
      expect(fs.existsSync(path.join(tempDir, 'src', 'services'))).toBe(false)
    })

    it('still writes an ordinary file path unchanged', async () => {
      const res = await agentToolExecutorService.executeTool(
        { tool: 'write_file', parameters: { filePath: 'src/services/api.ts', content: 'export const api = 1' } },
        tempDir,
        settings
      )

      expect(res.outputForHistory).toContain('Successfully wrote file')
      expect(fs.readFileSync(path.join(tempDir, 'src', 'services', 'api.ts'), 'utf-8')).toContain('export const api')
    })
  })

  describe('root configuration path guard', () => {
    it('refuses index.html under src and points to the project root', async () => {
      const misplaced = path.join(tempDir, 'src', 'index.html')
      const res = await agentToolExecutorService.executeTool(
        {
          tool: 'write_file',
          parameters: { filePath: misplaced, content: '<div id="root"></div>' },
        },
        tempDir,
        settings
      )

      expect(res.outputForHistory).toContain('[ROOT CONFIG PATH REJECTED]')
      expect(res.outputForHistory).toContain('index.html')
      expect(fs.existsSync(misplaced)).toBe(false)
    })

    it('allows index.html at the project root', async () => {
      const rootEntry = path.join(tempDir, 'index.html')
      const res = await agentToolExecutorService.executeTool(
        {
          tool: 'write_file',
          parameters: { filePath: rootEntry, content: '<div id="root"></div>' },
        },
        tempDir,
        settings
      )

      expect(res.outputForHistory).toContain('Successfully wrote file')
      expect(fs.existsSync(rootEntry)).toBe(true)
    })
  })

  describe('undeclared import gate', () => {
    it('tells the model immediately when a written file imports a package the project never declared', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ name: 'x', dependencies: { react: '^18.0.0', tailwindcss: '^3.0.0' } }),
        'utf-8'
      )

      const res = await agentToolExecutorService.executeTool(
        {
          tool: 'write_file',
          parameters: {
            filePath: 'src/pages/Dashboard.tsx',
            content: "import React from 'react'\nimport { Container } from '@tailwindcss/react'\nexport default function D() { return <Container /> }",
          },
        },
        tempDir,
        settings
      )

      // The write still lands: the code is mostly right and discarding it costs the turn.
      expect(fs.existsSync(path.join(tempDir, 'src', 'pages', 'Dashboard.tsx'))).toBe(true)
      expect(res.outputForHistory).toContain('Successfully wrote file')
      expect(res.outputForHistory).toContain('[UNDECLARED IMPORT IN src/pages/Dashboard.tsx]')
      expect(res.outputForHistory).toContain('@tailwindcss/react')
    })

    it('says nothing about a file whose imports are all declared', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ name: 'x', dependencies: { react: '^18.0.0' } }),
        'utf-8'
      )

      const res = await agentToolExecutorService.executeTool(
        { tool: 'write_file', parameters: { filePath: 'src/App.tsx', content: "import React from 'react'\nexport default function A() { return null }" } },
        tempDir,
        settings
      )

      expect(res.outputForHistory).toBe('Successfully wrote file src/App.tsx')
    })
  })

  it('appends the version-conflict directive when an install fails on ERESOLVE', async () => {
    // A script that reproduces npm's ERESOLVE report on stderr and exits 1, so the whole path
    // is exercised: shell -> stream composition -> auto-healing block. The real failure this
    // stands in for is `npm install @vitejs/plugin-react` against a pinned vite@4.
    fs.writeFileSync(
      path.join(tempDir, 'eresolve.js'),
      [
        "const lines = [",
        "  'npm error code ERESOLVE',",
        "  'npm error ERESOLVE unable to resolve dependency tree',",
        "  'npm error While resolving: project-dashboard-task@1.0.0',",
        "  'npm error Found: vite@4.5.14',",
        "  'npm error   dev vite@\"^4.2.3\" from the root project',",
        "  'npm error Could not resolve dependency:',",
        "  'npm error peer vite@\"^8.0.0\" from @vitejs/plugin-react@6.1.0',",
        "];",
        "console.error(lines.join('\\n'));",
        "process.exit(1);",
      ].join('\n'),
      'utf-8'
    )

    const res = await agentToolExecutorService.executeTool(
      { tool: 'run_command', parameters: { command: 'node eresolve.js', timeoutSeconds: 30 } },
      tempDir,
      settings
    )

    expect(res.outputForHistory).toContain('[DEPENDENCY VERSION CONFLICT — ERESOLVE]')
    expect(res.outputForHistory).toContain('npm install vite@^8.0.0')
    // The generic "install the missing dependency" advice is the one that just failed.
    expect(res.outputForHistory).not.toContain('[MISSING DEPENDENCY DIAGNOSTIC]')
  })

  /**
   * Measured 2026-08-25T19:16, session live-full-task, step 34. `npm run build` reported a TS2614
   * carrying the compiler's own verbatim import fix, a TS2322, and two `Cannot find module` on
   * './api' and './auth' — project files the plan had not written yet. The missing-dependency
   * gate matched the raw text, fired on the relative specifiers, and by firing set
   * `specificDirectiveFired`, which suppressed the compiler diagnostic entirely. The model was
   * left with an order to install a package the text never named; it guessed `@mui/material`,
   * the loop guard blocked it, and steps 35-50 were sixteen blocked repeats to the step ceiling.
   */
  describe('missing dependency diagnostic', () => {
    function failingBuild(lines: string[]): string {
      return [
        'const lines = ' + JSON.stringify(lines) + ';',
        'for (const line of lines) console.error(line);',
        'process.exit(2);',
      ].join('\n')
    }

    it('does not call an unwritten project file a missing dependency', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'build.js'),
        failingBuild([
          "src/services/index.ts(2,15): error TS2307: Cannot find module './api' or its corresponding type declarations.",
          "src/services/index.ts(3,15): error TS2307: Cannot find module './auth' or its corresponding type declarations.",
        ]),
        'utf-8'
      )

      const res = await agentToolExecutorService.executeTool(
        { tool: 'run_command', parameters: { command: 'node build.js', timeoutSeconds: 30 } },
        tempDir,
        settings
      )

      // `packageOfSpecifier` already knows relative imports belong to no package; this gate now asks it.
      expect(res.outputForHistory).not.toContain('[MISSING DEPENDENCY DIAGNOSTIC]')
      // And because the bogus dependency directive no longer fires, the compiler diagnostic is
      // free to run — landing on the branch that names the file that is actually missing rather
      // than the one that reports the error.
      expect(res.outputForHistory).toContain('THE IMPORTED FILE DOES NOT EXIST')
      expect(res.outputForHistory).toContain('"write_file" on "src/services/api.ts"')
    })

    it('lets the compiler fix survive alongside relative-path resolution errors', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'build.js'),
        failingBuild([
          `src/components/TaskCard.tsx(3,10): error TS2614: Module '"../components/Button"' has no exported member 'Button'. Did you mean to use 'import Button from "../components/Button"' instead?`,
          "src/services/index.ts(2,15): error TS2307: Cannot find module './api' or its corresponding type declarations.",
        ]),
        'utf-8'
      )

      const res = await agentToolExecutorService.executeTool(
        { tool: 'run_command', parameters: { command: 'node build.js', timeoutSeconds: 30 } },
        tempDir,
        settings
      )

      expect(res.outputForHistory).not.toContain('[MISSING DEPENDENCY DIAGNOSTIC]')
      // The exact regression: this is the directive the relative-path match used to suppress.
      expect(res.outputForHistory).toContain('IMPORT AND EXPORT DISAGREE')
      expect(res.outputForHistory).toContain(`import Button from "../components/Button"`)
    })

    it('names the package instead of shipping the literal placeholder', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'build.js'),
        failingBuild([
          "src/main.tsx(2,25): error TS2307: Cannot find module 'react-router-dom' or its corresponding type declarations.",
        ]),
        'utf-8'
      )

      const res = await agentToolExecutorService.executeTool(
        { tool: 'run_command', parameters: { command: 'node build.js', timeoutSeconds: 30 } },
        tempDir,
        settings
      )

      expect(res.outputForHistory).toContain('[MISSING DEPENDENCY DIAGNOSTIC]')
      expect(res.outputForHistory).toContain('npm install react-router-dom')
      // The old text handed the model `<package-name>` and left it to invent one.
      expect(res.outputForHistory).not.toContain('<package-name>')
    })
  })

  describe('redundant install guard', () => {
    it('skips an install whose packages are both declared and present in node_modules', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ name: 'x', dependencies: { react: '^18.0.0' } }),
        'utf-8'
      )
      fs.mkdirSync(path.join(tempDir, 'node_modules', 'react'), { recursive: true })

      const res = await agentToolExecutorService.executeTool(
        { tool: 'run_command', parameters: { command: 'npm install react' } },
        tempDir,
        settings
      )

      expect(res.outputForHistory).toContain('[REDUNDANT_INSTALL_SKIP]')
      expect(res.isTerminal).toBe(true)
    })

    it('lets the install run when the package is declared but node_modules is empty', async () => {
      // The regression that cost session-1787562597025-q8a5 its build: the agent had authored
      // package.json itself, so every dependency read as "already installed" while nothing was
      // on disk, and the guard cancelled the only npm install of the run.
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ name: 'x', dependencies: { react: '^18.0.0' } }),
        'utf-8'
      )

      const res = await agentToolExecutorService.executeTool(
        // --dry-run --offline keeps the assertion about the guard, not about npm's network.
        { tool: 'run_command', parameters: { command: 'npm install react --dry-run --offline --no-audit --no-fund', timeoutSeconds: 30 } },
        tempDir,
        settings
      )

      expect(res.outputForHistory).not.toContain('[REDUNDANT_INSTALL_SKIP]')
    }, 15000)
  })

  describe('install downgrade guard', () => {
    it('refuses the install that pinned the tree to react@16 in the run of 2026-08-25T12:11', async () => {
      // versionRealityDirective only ever saw `write_file` on package.json, so this command --
      // which rewrites the same file -- succeeded three times unchallenged (steps 21, 30, 31)
      // and left `react@"^16.14.0" from the root project`. Every later install of a package
      // built for react@18 then failed on ERESOLVE, and at step 49 the model deleted
      // @mui/material believing the name was invented.
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ name: 'x', dependencies: { react: '^18.2.0' } }),
        'utf-8'
      )

      const res = await agentToolExecutorService.executeTool(
        { tool: 'run_command', parameters: { command: 'npm install react@^16.8.0' } },
        tempDir,
        settings
      )

      expect(res.outputForHistory).toContain('[VERSION DOWNGRADE REFUSED — INSTALL NOT RUN]')
      expect(res.outputForHistory).toContain('"react": "^18.2.0"')
      expect(res.isTerminal).toBe(true)
      // Refused, not run: the manifest is untouched, which is the whole point of catching this
      // before execution rather than diffing package.json afterwards.
      expect(JSON.parse(fs.readFileSync(path.join(tempDir, 'package.json'), 'utf-8')).dependencies.react).toBe('^18.2.0')
    }, 20000)

    it('lets an upgrade through', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ name: 'x', dependencies: { react: '^18.2.0' } }),
        'utf-8'
      )

      const res = await agentToolExecutorService.executeTool(
        // --dry-run --offline keeps the assertion about the guard, not about npm's network.
        { tool: 'run_command', parameters: { command: 'npm install react@^19.0.0 --dry-run --offline --no-audit --no-fund', timeoutSeconds: 30 } },
        tempDir,
        settings
      )

      expect(res.outputForHistory).not.toContain('[VERSION DOWNGRADE REFUSED')
    }, 20000)
  })

  it('should block run_command via Shell-Tool Confusion Guard when a registered tool name is passed as a shell command', async () => {
    const res = await agentToolExecutorService.executeTool(
      {
        tool: 'run_command',
        parameters: { command: 'write_file "src/App.tsx" "content"' },
      },
      tempDir,
      settings
    )

    expect(res.outputForHistory).toContain('[TOOL_AS_SHELL_BLOCK]')
    expect(res.outputForHistory).toContain('EXECUTION BLOCKED: "write_file" is a structured tool, not a shell executable.')
    expect(res.logMessage).toContain('[TOOL_AS_SHELL_BLOCK] Blocked shell execution of tool "write_file"')
    expect(res.isTerminal).toBe(true)
  })

  it('should not trigger the Shell-Tool Confusion Guard for commands that do not start with a registered tool name', async () => {
    // "git reset --hard HEAD" does not start with any registered tool name, so it must fall
    // through the guard untouched and be handled by the command security guardrail instead.
    const res = await agentToolExecutorService.executeTool(
      {
        tool: 'run_command',
        parameters: { command: 'git reset --hard HEAD' },
      },
      tempDir,
      settings
    )

    expect(res.outputForHistory).not.toContain('[TOOL_AS_SHELL_BLOCK]')
    expect(res.outputForHistory).toContain('[SECURITY GUARDRAIL BLOCK]')
  })

  it('should execute get_file_info and return correct file metadata', async () => {
    const filePath = path.join(tempDir, 'info_test.ts')
    fs.writeFileSync(filePath, 'line 1\nline 2\nline 3', 'utf-8')

    const res = await agentToolExecutorService.executeTool(
      {
        tool: 'get_file_info',
        parameters: { filePath },
      },
      tempDir,
      settings
    )

    expect(res.outputForHistory).toContain('[FILE INFO:')
    expect(res.outputForHistory).toContain('Type: File')
    expect(res.outputForHistory).toContain('Line Count: 3')
    expect(res.outputForHistory).toContain('Is Binary: false')
  })

  it('should execute rollback_workspace and restore modified file state', async () => {
    const filePath = path.join(tempDir, 'rollback_test.txt')
    fs.writeFileSync(filePath, 'Original State', 'utf-8')

    // Modify file via executor (triggers journal recording)
    await agentToolExecutorService.executeTool(
      {
        tool: 'write_file',
        parameters: { filePath, content: 'Modified State' },
      },
      tempDir,
      settings
    )

    expect(fs.readFileSync(filePath, 'utf-8')).toBe('Modified State')

    // Trigger rollback
    const rollbackRes = await agentToolExecutorService.executeTool(
      {
        tool: 'rollback_workspace',
        parameters: {},
      },
      tempDir,
      settings
    )

    expect(rollbackRes.outputForHistory).toContain('[ATOMIC WORKSPACE ROLLBACK EXECUTED]')
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('Original State')
  })

  it('should execute rollback_last_step and undo only the most recent step, keeping earlier steps intact', async () => {
    const filePath = path.join(tempDir, 'step_rollback_test.txt')
    fs.writeFileSync(filePath, 'V1', 'utf-8')

    // Step 1 (as the orchestrator loop would drive it: tool call, then endJournalStep()): V1 -> V2
    await agentToolExecutorService.executeTool({ tool: 'write_file', parameters: { filePath, content: 'V2' } }, tempDir, settings)
    agentToolExecutorService.endJournalStep()

    // Step 2: V2 -> V3
    await agentToolExecutorService.executeTool({ tool: 'write_file', parameters: { filePath, content: 'V3' } }, tempDir, settings)
    agentToolExecutorService.endJournalStep()

    expect(fs.readFileSync(filePath, 'utf-8')).toBe('V3')

    const res = await agentToolExecutorService.executeTool({ tool: 'rollback_last_step', parameters: {} }, tempDir, settings)

    expect(res.outputForHistory).toContain('[LAST STEP ROLLBACK EXECUTED]')
    // Undid step 2 only: back to V2, not all the way to the session-start V1.
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('V2')

    agentToolExecutorService.commitJournal() // don't leak journal state into other tests sharing the singleton
  })

  it('should report nothing to undo when rollback_last_step has no completed step to reverse', async () => {
    agentToolExecutorService.commitJournal() // start from a clean journal regardless of test order

    const res = await agentToolExecutorService.executeTool({ tool: 'rollback_last_step', parameters: {} }, tempDir, settings)

    expect(res.outputForHistory).toContain('Nothing to undo')
    expect(res.logMessage).toBe('Rollback Last Step: nothing to undo')
  })

  it('should run an explicit run_tests command override and return a structured pass/fail summary (AGT8)', async () => {
    const res = await agentToolExecutorService.executeTool(
      {
        tool: 'run_tests',
        parameters: { command: 'node -e "console.log(\'Tests  5 passed (5)\')"' },
      },
      tempDir,
      settings
    )

    expect(res.outputForHistory).toContain('[TEST RUN RESULT]')
    expect(res.outputForHistory).toContain('5/5 tests passed (vitest)')
    expect(res.logMessage).toContain('Test Run:')
  }, 15000)

  it('should auto-detect the test command from package.json scripts.test when no explicit command is given', async () => {
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ name: 'fixture', scripts: { test: 'node -e "console.log(\'Tests  2 passed (2)\')"' } })
    )

    const res = await agentToolExecutorService.executeTool(
      { tool: 'run_tests', parameters: {} },
      tempDir,
      settings
    )

    expect(res.outputForHistory).toContain('auto-detected: package.json scripts.test')
    expect(res.outputForHistory).toContain('2/2 tests passed (vitest)')
  }, 15000)

  it('should prefer package.json scripts["test:fast"] over scripts.test when both are present', async () => {
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        scripts: {
          test: 'node -e "process.exit(1)"',
          'test:fast': 'node -e "console.log(\'Tests  1 passed (1)\')"',
        },
      })
    )

    const res = await agentToolExecutorService.executeTool(
      { tool: 'run_tests', parameters: {} },
      tempDir,
      settings
    )

    expect(res.outputForHistory).toContain('auto-detected: package.json scripts["test:fast"]')
    expect(res.outputForHistory).toContain('1/1 tests passed (vitest)')
  }, 15000)

  it('should return a graceful message when run_tests has no explicit command and no recognized test runner is found', async () => {
    const res = await agentToolExecutorService.executeTool(
      { tool: 'run_tests', parameters: {} },
      tempDir,
      settings
    )

    expect(res.outputForHistory).toContain('No test command specified and no recognized test runner')
    expect(res.logMessage).toBe('run_tests: no test runner detected')
  })

  it('should block a destructive run_tests command override via the security guardrail', async () => {
    const res = await agentToolExecutorService.executeTool(
      { tool: 'run_tests', parameters: { command: 'git reset --hard HEAD' } },
      tempDir,
      settings
    )

    expect(res.outputForHistory).toContain('[SECURITY GUARDRAIL BLOCK]')
    expect(res.logMessage).toContain('[SECURITY BLOCK]')
  })

  it('should execute git_status and git_diff without errors', async () => {
    const statusRes = await agentToolExecutorService.executeTool(
      {
        tool: 'git_status',
        parameters: {},
      },
      process.cwd(),
      settings
    )
    expect(statusRes.outputForHistory).toContain('[GIT STATUS:')

    const diffRes = await agentToolExecutorService.executeTool(
      {
        tool: 'git_diff',
        parameters: {},
      },
      process.cwd(),
      settings
    )
    expect(diffRes.outputForHistory).toContain('[GIT DIFF')
  })

  it('should execute git_commit successfully on an isolated temp git repository', async () => {
    execSync('git init', { cwd: tempDir })
    execSync('git config user.email "test@onlyrag.local"', { cwd: tempDir })
    execSync('git config user.name "OnlyRag Test"', { cwd: tempDir })
    fs.writeFileSync(path.join(tempDir, 'file.txt'), 'hello')

    const res = await agentToolExecutorService.executeTool(
      {
        tool: 'git_commit',
        parameters: { commitMessage: 'Add file.txt' },
      },
      tempDir,
      settings
    )

    expect(res.outputForHistory).toContain('[GIT COMMIT:')
    expect(res.logMessage).toContain('Git Commit created')
    const log = execSync('git log --oneline -1', { cwd: tempDir, encoding: 'utf-8' })
    expect(log).toContain('Add file.txt')
  }, 15000)

  it('should return an error when git_commit is called without a commitMessage', async () => {
    const res = await agentToolExecutorService.executeTool(
      {
        tool: 'git_commit',
        parameters: {},
      },
      tempDir,
      settings
    )

    expect(res.outputForHistory).toContain('commitMessage')
    expect(res.logMessage).toContain('missing commit message')
  })

  it('performGitCommit (called directly, as workspaceAppService.gitCommit does from the approval-flow IPC handler) commits successfully', () => {
    execSync('git init', { cwd: tempDir })
    execSync('git config user.email "test@onlyrag.local"', { cwd: tempDir })
    execSync('git config user.name "OnlyRag Test"', { cwd: tempDir })
    fs.writeFileSync(path.join(tempDir, 'direct.txt'), 'hello')

    const res = agentToolExecutorService.performGitCommit(tempDir, 'Add direct.txt')

    expect(res.success).toBe(true)
    expect(res.output).toContain('[GIT COMMIT:')
    expect(res.logMessage).toContain('Git Commit created')
    const log = execSync('git log --oneline -1', { cwd: tempDir, encoding: 'utf-8' })
    expect(log).toContain('Add direct.txt')
  }, 15000)

  it('performGitCommit returns success: false with no commitMessage, without touching git', () => {
    const res = agentToolExecutorService.performGitCommit(tempDir, '')
    expect(res.success).toBe(false)
    expect(res.logMessage).toContain('missing commit message')
  })

  it('should report line-level change stats for write_file, distinguishing a new file from an edit', async () => {
    const filePath = path.join(tempDir, 'metrics.txt')

    const created = await agentToolExecutorService.executeTool(
      { tool: 'write_file', parameters: { filePath, content: 'a\nb\nc' } },
      tempDir,
      settings
    )
    expect(created.changeStats).toEqual({ filePath, additions: 3, deletions: 0 })

    const edited = await agentToolExecutorService.executeTool(
      { tool: 'write_file', parameters: { filePath, content: 'a\nB\nc' } },
      tempDir,
      settings
    )
    expect(edited.changeStats).toEqual({ filePath, additions: 1, deletions: 1 })
  })

  describe('no-op write', () => {
    // A rewrite that changed nothing used to answer "Successfully wrote file X" and count as a
    // file mutation, which cleared the verified-build flag and sent the model back to re-run a
    // build it had never broken. See redundantWriteDetector.ts.
    it('does not touch the disk and reports the write as a no-op when the content is already there', async () => {
      const filePath = path.join(tempDir, 'stable.ts')
      const body = 'export const a = 1\n'
      await agentToolExecutorService.executeTool({ tool: 'write_file', parameters: { filePath, content: body } }, tempDir, settings)
      const mtimeBefore = fs.statSync(filePath).mtimeMs

      const repeat = await agentToolExecutorService.executeTool(
        { tool: 'write_file', parameters: { filePath, content: body } },
        tempDir,
        settings
      )

      expect(repeat.noOpMutation).toBe(true)
      expect(repeat.outputForHistory).toContain('NO-OP WRITE')
      expect(repeat.changeStats).toBeUndefined()
      // The untouched mtime matters on its own: scanCommandTouchedFiles attributes files by
      // mtime, so a rewritten timestamp alone would re-report the file as changed.
      expect(fs.statSync(filePath).mtimeMs).toBe(mtimeBefore)
    })

    it('still writes and reports a real edit as a real edit', async () => {
      const filePath = path.join(tempDir, 'changing.ts')
      await agentToolExecutorService.executeTool(
        { tool: 'write_file', parameters: { filePath, content: 'export const a = 1\n' } },
        tempDir,
        settings
      )

      const edited = await agentToolExecutorService.executeTool(
        { tool: 'write_file', parameters: { filePath, content: 'export const a = 2\n' } },
        tempDir,
        settings
      )

      expect(edited.noOpMutation).toBeUndefined()
      expect(edited.outputForHistory).toContain('Successfully wrote file')
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('export const a = 2\n')
    })

    it('creates a file that does not exist yet, even with empty content', async () => {
      const filePath = path.join(tempDir, 'brand-new.txt')

      const created = await agentToolExecutorService.executeTool(
        { tool: 'write_file', parameters: { filePath, content: '' } },
        tempDir,
        settings
      )

      expect(created.noOpMutation).toBeUndefined()
      expect(fs.existsSync(filePath)).toBe(true)
    })
  })

  it('should report change stats for replace_file_content and delete_file', async () => {
    const filePath = path.join(tempDir, 'replace-metrics.txt')
    fs.writeFileSync(filePath, 'one\ntwo\nthree')

    const replaced = await agentToolExecutorService.executeTool(
      { tool: 'replace_file_content', parameters: { filePath, targetContent: 'two', replacementContent: 'TWO' } },
      tempDir,
      settings
    )
    expect(replaced.changeStats).toEqual({ filePath, additions: 1, deletions: 1 })

    const deleted = await agentToolExecutorService.executeTool(
      { tool: 'delete_file', parameters: { filePath } },
      tempDir,
      settings
    )
    expect(deleted.changeStats).toEqual({ filePath, additions: 0, deletions: 3 })
  })

  it('should refuse to install anything outside the toolchain allow-list', async () => {
    const res = await agentToolExecutorService.executeTool(
      { tool: 'ensure_tool', parameters: { toolName: 'docker' } } as any,
      tempDir,
      settings
    )

    expect(res.outputForHistory).toContain('ENSURE_TOOL REJECTED')
    expect(res.outputForHistory).toContain('not an installable development tool')
    expect(res.logMessage).toContain('not allow-listed')
  })

  it('should report an already-installed tool without attempting any installation', async () => {
    // node is running this very test suite, so it is guaranteed present.
    const res = await agentToolExecutorService.executeTool(
      { tool: 'ensure_tool', parameters: { toolName: 'node' } } as any,
      tempDir,
      settings
    )

    expect(res.outputForHistory).toContain('already installed')
    expect(res.outputForHistory).not.toContain('winget install')
  })

  it('should include the development toolchain inventory in inspect_os_env', async () => {
    const res = await agentToolExecutorService.executeTool(
      { tool: 'inspect_os_env', parameters: {} },
      tempDir,
      settings
    )

    expect(res.outputForHistory).toContain('Guest OS Environment')
    expect(res.outputForHistory).toContain('DEVELOPMENT TOOLCHAIN')
    expect(res.outputForHistory).toMatch(/- node: OK \(/)
  })

  it('should not report change stats for a rejected mutation', async () => {
    const filePath = path.join(tempDir, 'absent.txt')
    const res = await agentToolExecutorService.executeTool(
      { tool: 'replace_file_content', parameters: { filePath, targetContent: 'x', replacementContent: 'y' } },
      tempDir,
      settings
    )

    expect(res.changeStats).toBeUndefined()
  })

  it('should handle open_in_browser parameter validation and missing target', async () => {
    const missingParams = await agentToolExecutorService.executeTool(
      { tool: 'open_in_browser', parameters: {} },
      tempDir,
      settings
    )
    expect(missingParams.outputForHistory).toContain('missing "filePath" or "url"')

    const missingFile = await agentToolExecutorService.executeTool(
      { tool: 'open_in_browser', parameters: { filePath: 'nonexistent.html' } },
      tempDir,
      settings
    )
    expect(missingFile.outputForHistory).toContain('File not found to open')
  })

  it('should execute list_files_recursive and get_file_info correctly', async () => {
    const subDir = path.join(tempDir, 'subfolder')
    fs.mkdirSync(subDir, { recursive: true })
    const file1 = path.join(tempDir, 'root.txt')
    const file2 = path.join(subDir, 'nested.pdf')
    fs.writeFileSync(file1, 'root content', 'utf-8')
    fs.writeFileSync(file2, 'pdf content', 'utf-8')

    const listRes = await agentToolExecutorService.executeTool(
      { tool: 'list_files_recursive', parameters: { dirPath: tempDir, maxDepth: 2 } },
      tempDir,
      settings
    )
    expect(listRes.outputForHistory).toContain('root.txt')
    expect(listRes.outputForHistory).toContain('nested.pdf')

    const infoRes = await agentToolExecutorService.executeTool(
      { tool: 'get_file_info', parameters: { filePath: file2 } },
      tempDir,
      settings
    )
    expect(infoRes.outputForHistory).toContain('[FILE INFO:')
    expect(infoRes.outputForHistory).toContain('nested.pdf')
  })

  it('should execute create_directory, copy_file, and move_file correctly', async () => {
    const newDir = path.join(tempDir, 'new_dir')
    const createDirRes = await agentToolExecutorService.executeTool(
      { tool: 'create_directory', parameters: { dirPath: newDir } },
      tempDir,
      settings
    )
    expect(createDirRes.outputForHistory).toContain('Successfully created directory')
    expect(fs.existsSync(newDir)).toBe(true)

    const srcFile = path.join(tempDir, 'source.txt')
    fs.writeFileSync(srcFile, 'source text', 'utf-8')

    const copyDst = path.join(newDir, 'copied.txt')
    const copyRes = await agentToolExecutorService.executeTool(
      { tool: 'copy_file', parameters: { sourcePath: srcFile, targetPath: copyDst } },
      tempDir,
      settings
    )
    expect(copyRes.outputForHistory).toContain('Successfully copied')
    expect(fs.existsSync(copyDst)).toBe(true)

    const moveDst = path.join(newDir, 'moved.txt')
    const moveRes = await agentToolExecutorService.executeTool(
      { tool: 'move_file', parameters: { sourcePath: copyDst, targetPath: moveDst } },
      tempDir,
      settings
    )
    expect(moveRes.outputForHistory).toContain('Successfully moved')
    expect(fs.existsSync(moveDst)).toBe(true)
    expect(fs.existsSync(copyDst)).toBe(false)
  })
})


