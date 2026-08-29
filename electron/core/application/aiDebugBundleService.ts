/**
 * electron/core/application/aiDebugBundleService.ts
 *
 * Application Layer — AI Debug Diagnostic Bundle Generator.
 * Compiles a structured, zero-noise, high-density diagnostic markdown report
 * designed specifically to be analyzed by an AI assistant
 * to immediately identify root causes and generate concrete fixes.
 */

import os from 'node:os'
import { agentSessionStateRepository } from '../infrastructure/filesystem/agentSessionStateRepository'
import { gitCliRepository } from '../infrastructure/process/gitCliRepository'
import { devToolProbeRepository } from '../infrastructure/process/devToolProbeRepository'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'
import { DEV_TOOL_ALLOWLIST, extractVersion } from '../domain/agent/devToolchain'
import stripAnsi from 'strip-ansi'
import type { AppSettings } from '../../../shared/types'

export interface AiDebugBundleOptions {
  sessionId: string
  workspacePath?: string | null
  settings?: AppSettings
  activeModelName?: string
  activeSkills?: string[]
}

export class AiDebugBundleService {
  /**
   * Generates a self-contained AI-optimized debug diagnostic bundle in Markdown.
   */
  public async generateDebugBundle(options: AiDebugBundleOptions): Promise<string> {
    const { sessionId, workspacePath, activeModelName = 'LLM', activeSkills = [] } = options
    const timestamp = new Date().toISOString()

    // 1. Host & Toolchain facts
    const hostInfo = `${os.platform()} (${os.arch()}) | CPUs: ${os.cpus().length} | RAM Free: ${(os.freemem() / 1024 / 1024 / 1024).toFixed(2)}GB / ${(os.totalmem() / 1024 / 1024 / 1024).toFixed(2)}GB`
    
    const toolchainStatuses = DEV_TOOL_ALLOWLIST.map((tool) => {
      const stdout = devToolProbeRepository.probeVersion(tool.binary, tool.versionArgs)
      const version = stdout ? extractVersion(stdout) : null
      return `${tool.displayName}: ${version || 'NOT INSTALLED'}`
    }).join(' | ')

    // 2. Load Session State
    const sessionState = await agentSessionStateRepository.loadSessionState(sessionId, workspacePath)

    // 3. Load Git Diff
    let gitDiffBlock = 'No Git repository detected or no working tree changes.'
    let gitStatusLines: string[] = []
    if (workspacePath) {
      try {
        const rawStatus = gitCliRepository.run(workspacePath, 'status --short', 10000)
        gitStatusLines = rawStatus ? rawStatus.split(/\r?\n/).filter((l) => l.trim().length > 0) : []
        const rawDiff = gitCliRepository.run(workspacePath, 'diff', 15000)
        if (rawDiff && rawDiff.trim()) {
          gitDiffBlock = `\`\`\`diff\n${rawDiff.trim().slice(0, 12000)}\n\`\`\``
        } else if (gitStatusLines.length > 0) {
          gitDiffBlock = `Status:\n${gitStatusLines.join('\n')}\n(No text diff generated)`
        }
      } catch (err: any) {
        gitDiffBlock = `Git inspection error: ${err.message}`
      }
    }

    // 4. Build Trajectory Table & Extract Failures
    const episodes = sessionState?.episodes || []
    const rawLogs = sessionState?.recentFullLogs || []

    const trajectoryRows = episodes.map((ep) => {
      const statusIcon = ep.status === 'SUCCESS' ? '✅ SUCCESS' : ep.status === 'FAILURE' ? '❌ FAILURE' : '⛔ BLOCKED'
      const cleanTarget = (ep.target || '-').replace(/[\r\n|]/g, ' ')
      const cleanSummary = (ep.summary || '').replace(/[\r\n|]/g, ' ').slice(0, 100)
      return `| ${ep.step} | \`${ep.tool}\` | \`${cleanTarget}\` | ${statusIcon} | ${cleanSummary} |`
    })

    const trajectoryTable =
      trajectoryRows.length > 0
        ? [
            '| Step | Tool | Target | Status | Esito / Summary |',
            '|:---:|:---|:---|:---:|:---|',
            ...trajectoryRows,
          ].join('\n')
        : 'Nessun passaggio registrato per questa sessione.'

    // 5. Extract critical failures & stack traces
    const failureLogs = rawLogs.filter((l: any) => {
      const text = l.output || ''
      return (
        l.isFailure ||
        text.includes('Error:') ||
        text.includes('FAIL') ||
        text.includes('Exception') ||
        text.includes('failed') ||
        text.includes('Security Violation')
      )
    })

    let failureSection = 'Nessun errore fatale riscontrato durante l\'esecuzione.'
    if (failureLogs.length > 0) {
      failureSection = failureLogs
        .map((f: any) => {
          const cleanOutput = stripAnsi(f.output).slice(0, 3000)
          return `### ⚠️ Step ${f.step} — Tool: \`${f.tool}\`\n\`\`\`text\n${cleanOutput}\n\`\`\``
        })
        .join('\n\n')
    }

    // Keep the complete chronological payload available to a log analyst. The
    // trajectory above is intentionally compact, but it is not sufficient to
    // diagnose prompt assembly, model output, or a tool's exact response.
    const persistedAuditLog = codingAgentLogger.readSessionAuditLog(sessionId)
    const detailedLogSection = persistedAuditLog || (rawLogs.length > 0
      ? rawLogs.map((entry: any) => [
          `### Step ${entry.step} — Tool: \`${entry.tool}\``,
          '```text',
          stripAnsi(String(entry.output || '')),
          '```',
        ].join('\n')).join('\n\n')
      : 'Nessun dettaglio cronologico persistito per questa sessione.')

    // 6. Plan Milestones State
    const milestones = sessionState?.planMilestones || []
    let planSummary = 'Nessun piano formalizzato per questa sessione.'
    if (milestones.length > 0) {
      const completed = milestones.filter((m) => m.status === 'verified').length
      const lines = milestones.map((m, idx) => {
        const icon = m.status === 'verified' ? '[x]' : m.status === 'in_progress' ? '[>]' : m.status === 'failed' ? '[!]' : '[ ]'
        return `${idx + 1}. ${icon} **${m.title}** (Status: ${m.status.toUpperCase()})${m.notes ? ` — *${m.notes}*` : ''}`
      })
      planSummary = `Progresso: **${completed}/${milestones.length} (${Math.round((completed / milestones.length) * 100)}%)**\n${lines.join('\n')}`
    }

    // 7. Compile the Final Markdown Bundle
    const userPrompt = sessionState?.userTask || sessionState?.initialUserTask || 'N/A'
    const agentMode = sessionState?.agentMode || 'AGENT'

    const bundle = `# 🐞 ONLYRAG V2 — CODING AGENT DEBUG BUNDLE
*Generato per AI Diagnostic Assistant — ${timestamp}*

> [!IMPORTANT]
> **Prompt for AI Assistant:**
> Analizza questo log di diagnostica di OnlyRag V2 Coding Agent Studio.
> Identifica la causa radice del fallimento, dell'errore o dell'interruzione, e fornisci la soluzione esatta (patch di codice con diff, comandi terminale corretti o correzione architetturale).

---

## 1. System & Runtime Environment
- **Host OS:** ${hostInfo}
- **Toolchain Status:** ${toolchainStatuses}
- **Active Model:** \`${activeModelName}\`
- **Active Workspace:** \`${workspacePath || 'Standalone'}\`
- **Active Skills:** ${activeSkills.length > 0 ? activeSkills.map((s) => `\`${s}\``).join(', ') : 'None'}
- **Session ID:** \`${sessionId}\`

---

## 2. User Prompt & Execution Goal
- **Agent Mode:** \`${agentMode.toUpperCase()}\`
- **Prompt Utente Originale:**
\`\`\`text
${userPrompt}
\`\`\`

---

## 3. Chronological Step Trajectory
${trajectoryTable}

---

## 4. Critical Errors, Failures & Clean Stack Traces
${failureSection}

---

## 5. Complete Chronological Tool Flow
${detailedLogSection}

---

## 6. File Modifications & Working Tree Diff
- **Status Git Files:** ${gitStatusLines.length > 0 ? gitStatusLines.join(', ') : 'None'}
- **Diff Unificato:**
${gitDiffBlock}

---

## 7. Execution Plan & Milestones State
${planSummary}

---
*Fine del Debug Diagnostic Bundle.*
`

    return bundle
  }
}

export const aiDebugBundleService = new AiDebugBundleService()
