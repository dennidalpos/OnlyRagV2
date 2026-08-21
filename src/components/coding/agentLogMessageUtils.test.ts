import { describe, it, expect } from 'vitest'
import {
  getBadgeLang,
  getStepModelName,
  extractBaseName,
  resolveLogCategory,
} from './agentLogMessageUtils'
import { AgentActionLog } from '../../types'

describe('agentLogMessageUtils Unit Tests', () => {
  describe('getBadgeLang', () => {
    it('should resolve correct language badges and styles for various file types', () => {
      expect(getBadgeLang('app.tsx')).toMatchObject({ label: 'TS' })
      expect(getBadgeLang('server.ts')).toMatchObject({ label: 'TS' })
      expect(getBadgeLang('script.js')).toMatchObject({ label: 'JS' })
      expect(getBadgeLang('module.mjs')).toMatchObject({ label: 'JS' })
      expect(getBadgeLang('sidecar.py')).toMatchObject({ label: 'PY' })
      expect(getBadgeLang('package.json')).toMatchObject({ label: 'JSON' })
      expect(getBadgeLang('style.css')).toMatchObject({ label: 'CSS' })
      expect(getBadgeLang('index.html')).toMatchObject({ label: 'HTML' })
      expect(getBadgeLang('README.md')).toMatchObject({ label: 'MD' })
      expect(getBadgeLang('script.ps1')).toMatchObject({ label: 'PS1' })
      expect(getBadgeLang('deploy.sh')).toMatchObject({ label: 'SH' })
      expect(getBadgeLang('config.yaml')).toMatchObject({ label: 'YAML' })
      expect(getBadgeLang('cargo.toml')).toMatchObject({ label: 'TOML' })
      expect(getBadgeLang('schema.sql')).toMatchObject({ label: 'SQL' })
      expect(getBadgeLang('main.rs')).toMatchObject({ label: 'RS' })
      expect(getBadgeLang('main.go')).toMatchObject({ label: 'GO' })
      expect(getBadgeLang('notes.txt')).toMatchObject({ label: 'FILE' })
      expect(getBadgeLang(undefined)).toMatchObject({ label: 'FILE' })
    })
  })

  describe('getStepModelName', () => {
    it('should extract model tag from consulting log', () => {
      expect(getStepModelName('Consulting LLM (qwen2.5-coder:7b)...')).toBe('qwen2.5-coder:7b')
    })

    it('should extract model tag from escalation log', () => {
      expect(getStepModelName('Escalating to: deepseek-r1:8b')).toBe('deepseek-r1:8b')
      expect(getStepModelName('Complexity Escalated: llama3.2:3b')).toBe('llama3.2:3b')
      expect(getStepModelName('Escalating to heavy tier [qwen2.5-coder:14b]')).toBe('qwen2.5-coder:14b')
    })

    it('should return fallbackModelName when no model is recognized', () => {
      expect(getStepModelName('Ordinary info message', 'default-model')).toBe('default-model')
      expect(getStepModelName('', 'default-model')).toBe('default-model')
    })
  })

  describe('extractBaseName', () => {
    it('should extract the filename from Windows and POSIX paths', () => {
      expect(extractBaseName('src\\components\\App.tsx')).toBe('App.tsx')
      expect(extractBaseName('src/components/Button.tsx')).toBe('Button.tsx')
      expect(extractBaseName('index.html')).toBe('index.html')
      expect(extractBaseName('src/utils/diff.ts (confidence 100%)')).toBe('diff.ts')
    })
  })

  describe('resolveLogCategory', () => {
    it('should resolve structured log metadata when present', () => {
      const log: AgentActionLog = {
        id: '1',
        type: 'tool_call',
        message: 'Created src/components/App.tsx',
        timestamp: new Date().toISOString(),
        category: 'file_mutation',
        verb: 'Created',
        target: 'src/components/App.tsx',
        status: 'success',
      }
      const res = resolveLogCategory(log)
      expect(res.category).toBe('file_mutation')
      expect(res.verb).toBe('Created')
      expect(res.target).toBe('src/components/App.tsx')
    })

    it('should fallback gracefully for legacy unannotated logs', () => {
      const userLog: AgentActionLog = {
        id: '2',
        type: 'info',
        message: 'User Prompt: Build a new feature',
        timestamp: new Date().toISOString(),
      }
      expect(resolveLogCategory(userLog).category).toBe('user_prompt')

      const cmdLog: AgentActionLog = {
        id: '3',
        type: 'terminal',
        message: 'npm test',
        timestamp: new Date().toISOString(),
      }
      expect(resolveLogCategory(cmdLog).category).toBe('command_execution')

      const finalLog: AgentActionLog = {
        id: '4',
        type: 'info',
        message: 'Task Finished: All done',
        timestamp: new Date().toISOString(),
      }
      expect(resolveLogCategory(finalLog).category).toBe('final_report')
    })
  })
})
