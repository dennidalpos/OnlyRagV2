import { describe, it, expect } from 'vitest'
import {
  categorizeAgentLog,
  getBadgeLang,
  getStepModelName,
} from './agentLogMessageUtils'

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

  describe('categorizeAgentLog', () => {
    it('should categorize user prompt messages', () => {
      const res = categorizeAgentLog('User Prompt: Refactor the auth module')
      expect(res.category).toBe('user_prompt')
      expect(res.userPromptText).toBe('Refactor the auth module')
    })

    it('should categorize agent question and clarification requests', () => {
      const res1 = categorizeAgentLog('❓ AI Agent Question: Should I use TypeScript or JavaScript?')
      expect(res1.category).toBe('agent_question')
      expect(res1.agentQuestionText).toBe('Should I use TypeScript or JavaScript?')

      const res2 = categorizeAgentLog('Agent requested clarification: Please provide the port number')
      expect(res2.category).toBe('agent_question')
      expect(res2.agentQuestionText).toBe('Please provide the port number')
    })

    it('should categorize final implementation reports (Task Finished)', () => {
      const res = categorizeAgentLog('Task Finished: ### 🎯 Riepilogo Implementazione\n- Creato file index.html\n- Test passati al 100%')
      expect(res.category).toBe('final_report')
      expect(res.finalReportText).toContain('### 🎯 Riepilogo Implementazione')
      expect(res.finalReportText).toContain('Creato file index.html')
    })

    it('should categorize test runs with PASS/FAIL details', () => {
      const resPass = categorizeAgentLog('Test Run: PASS (15 passed, 0 failed)')
      expect(resPass.category).toBe('test_run')
      expect(resPass.testRun?.isPass).toBe(true)
      expect(resPass.testRun?.passedCount).toBe(15)

      const resFail = categorizeAgentLog('Test Run: FAIL (2 failed, 10 passed)')
      expect(resFail.category).toBe('test_run')
      expect(resFail.testRun?.isPass).toBe(false)
      expect(resFail.testRun?.failedCount).toBe(2)
      expect(resFail.testRun?.passedCount).toBe(10)
    })

    it('should categorize file creations (write_file)', () => {
      const res = categorizeAgentLog('Successfully wrote file src/components/App.tsx')
      expect(res.category).toBe('file_mutation')
      expect(res.fileMutation?.verb).toBe('Created')
      expect(res.fileMutation?.fileName).toBe('App.tsx')
      expect(res.fileMutation?.filePath).toBe('src/components/App.tsx')
    })

    it('should categorize file edits (replace_file_content / multi_replace)', () => {
      const resChunk = categorizeAgentLog('Successfully replaced target chunk in src/utils/diffEngine.ts (Fuzzy Match Confidence: 100.0%)')
      expect(resChunk.category).toBe('file_mutation')
      expect(resChunk.fileMutation?.verb).toBe('Edited')
      expect(resChunk.fileMutation?.fileName).toBe('diffEngine.ts')

      const resMulti = categorizeAgentLog('Successfully applied 3 replacements in electron/main.ts')
      expect(resMulti.category).toBe('file_mutation')
      expect(resMulti.fileMutation?.verb).toBe('Edited')
      expect(resMulti.fileMutation?.fileName).toBe('main.ts')

      const resEdited = categorizeAgentLog('Edited src/index.css')
      expect(resEdited.category).toBe('file_mutation')
      expect(resEdited.fileMutation?.verb).toBe('Edited')
      expect(resEdited.fileMutation?.fileName).toBe('index.css')
    })

    it('should categorize file deletions, moves, and copies', () => {
      const resDel = categorizeAgentLog('Successfully deleted file old_script.js')
      expect(resDel.category).toBe('file_mutation')
      expect(resDel.fileMutation?.verb).toBe('Deleted')
      expect(resDel.fileMutation?.fileName).toBe('old_script.js')

      const resMove = categorizeAgentLog('Successfully moved src/temp.ts -> src/final.ts')
      expect(resMove.category).toBe('file_mutation')
      expect(resMove.fileMutation?.verb).toBe('Moved')
      expect(resMove.fileMutation?.fileName).toBe('final.ts')

      const resCopy = categorizeAgentLog('Successfully copied template.json -> config.json')
      expect(resCopy.category).toBe('file_mutation')
      expect(resCopy.fileMutation?.verb).toBe('Copied')
      expect(resCopy.fileMutation?.fileName).toBe('config.json')

      const resMkdir = categorizeAgentLog('Successfully created directory src/lib/helpers')
      expect(resMkdir.category).toBe('file_mutation')
      expect(resMkdir.fileMutation?.verb).toBe('Created')
      expect(resMkdir.fileMutation?.fileName).toBe('helpers')
    })

    it('should categorize command executions', () => {
      const resRan = categorizeAgentLog('Ran npm run test:fast')
      expect(resRan.category).toBe('command_execution')
      expect(resRan.commandExecution?.command).toBe('npm run test:fast')
      expect(resRan.commandExecution?.isInstall).toBe(false)

      const resInstall = categorizeAgentLog('Ran npm install -D tailwindcss')
      expect(resInstall.category).toBe('command_execution')
      expect(resInstall.commandExecution?.isInstall).toBe(true)

      const resTerminal = categorizeAgentLog('ls -la', 'terminal')
      expect(resTerminal.category).toBe('command_execution')
    })

    it('should categorize web research actions', () => {
      const resSearch = categorizeAgentLog('Web search: react 19 useActionState')
      expect(resSearch.category).toBe('web_research')
      expect(resSearch.webResearch?.action).toBe('Search')
      expect(resSearch.webResearch?.queryOrUrl).toBe('react 19 useActionState')

      const resFetch = categorizeAgentLog('Fetched web content: https://vite.dev/guide')
      expect(resFetch.category).toBe('web_research')
      expect(resFetch.webResearch?.action).toBe('Fetch')
      expect(resFetch.webResearch?.queryOrUrl).toBe('https://vite.dev/guide')

      const resDownload = categorizeAgentLog('Downloaded file: https://example.com/asset.png')
      expect(resDownload.category).toBe('web_research')
      expect(resDownload.webResearch?.action).toBe('Download')
    })

    it('should categorize workspace exploration', () => {
      const resRead = categorizeAgentLog('Read file package.json (lines 1-50)')
      expect(resRead.category).toBe('workspace_exploration')
      expect(resRead.workspaceExploration?.action).toBe('Read')

      const resGrep = categorizeAgentLog('Grep search: "export function"')
      expect(resGrep.category).toBe('workspace_exploration')
      expect(resGrep.workspaceExploration?.action).toBe('Grep')

      const resList = categorizeAgentLog('Recursive List: 42 items in src/')
      expect(resList.category).toBe('workspace_exploration')
      expect(resList.workspaceExploration?.action).toBe('List')
    })

    it('should categorize plan updates and generic assistant messages', () => {
      const resPlan = categorizeAgentLog('[PLAN Mode] Proposed Tool: write_file')
      expect(resPlan.category).toBe('plan_update')

      const resGeneric = categorizeAgentLog('I have completed analyzing the files.')
      expect(resGeneric.category).toBe('generic_assistant')
    })
  })
})
