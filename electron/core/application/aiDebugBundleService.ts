import os from 'node:os'
import { agentSessionStateRepository } from '../infrastructure/filesystem/agentSessionStateRepository'
import { gitCliRepository } from '../infrastructure/process/gitCliRepository'
import { devToolProbeRepository } from '../infrastructure/process/devToolProbeRepository'
import { codingAgentLogger } from '../infrastructure/logging/codingAgentLogger'
import { DEV_TOOL_ALLOWLIST, extractVersion } from '../domain/agent/devToolchain'
import stripAnsi from 'strip-ansi'
import type { AppSettings } from '../../../shared/types'
import { redactSecrets } from '../../logRedactor'
import { MAX_FAILURES_PER_RECOVERY_CATEGORY } from '../domain/agent/recoveryBudget'
import { MAX_VERIFICATION_FIX_CYCLES } from '../domain/agent/verificationGatePolicy'
import { isCodingAgentDebugPayloadCaptureEnabled } from '../../../shared/domain/agent/codingAgentDebugPolicy'
import { errorMessage } from '../../../shared/domain/errors/errorMessage'

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
    const { sessionId, workspacePath, settings, activeModelName = 'LLM', activeSkills = [] } = options
    const includePayloads = isCodingAgentDebugPayloadCaptureEnabled(settings)
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
        const rawStatus = gitCliRepository.run(workspacePath, ['status', '--short'], 10000)
        gitStatusLines = rawStatus ? rawStatus.split(/\r?\n/).filter((l) => l.trim().length > 0) : []
        const rawDiff = includePayloads ? gitCliRepository.run(workspacePath, ['diff'], 15000) : ''
        if (rawDiff && rawDiff.trim()) {
          gitDiffBlock = `\`\`\`diff\n${rawDiff.trim().slice(0, 12000)}\n\`\`\``
        } else if (gitStatusLines.length > 0 && includePayloads) {
          gitDiffBlock = `Status:\n${gitStatusLines.join('\n')}\n(No text diff generated)`
        } else if (gitStatusLines.length > 0) {
          gitDiffBlock = `${gitStatusLines.length} changed path(s); names and diff omitted by metadata-only logging.`
        }
      } catch (err: unknown) {
        gitDiffBlock = `Git inspection error: ${errorMessage(err)}`
      }
    }

    // 4. Build Trajectory Table & Extract Failures
    const episodes = sessionState?.episodes || []
    const rawLogs = sessionState?.recentFullLogs || []

    const trajectoryRows = episodes.map((ep) => {
      const statusIcon = ep.status === 'SUCCESS' ? '✅ SUCCESS' : ep.status === 'FAILURE' ? '❌ FAILURE' : '⛔ BLOCKED'
      const cleanTarget = includePayloads ? (ep.target || '-').replace(/[\r\n|]/g, ' ') : '[omitted]'
      const cleanSummary = includePayloads ? (ep.summary || '').replace(/[\r\n|]/g, ' ').slice(0, 100) : '[metadata only]'
      return `| ${ep.step} | \`${ep.tool}\` | \`${cleanTarget}\` | ${statusIcon} | ${cleanSummary} |`
    })

    const trajectoryTable =
      trajectoryRows.length > 0
        ? ['| Step | Tool | Target | Status | Esito / Summary |', '|:---:|:---|:---|:---:|:---|', ...trajectoryRows].join('\n')
        : 'Nessun passaggio registrato per questa sessione.'

    // 5. Extract critical failures & stack traces
    const failureLogs = rawLogs.filter((l) => {
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

    let failureSection = "Nessun errore fatale riscontrato durante l'esecuzione."
    if (failureLogs.length > 0) {
      failureSection = failureLogs
        .map((f) => {
          const cleanOutput = includePayloads ? stripAnsi(f.output).slice(0, 3000) : `[payload omitted; ${String(f.output || '').length} chars]`
          return `### ⚠️ Step ${f.step} — Tool: \`${f.tool}\`\n\`\`\`text\n${cleanOutput}\n\`\`\``
        })
        .join('\n\n')
    }

    // Keep the complete chronological payload available to a log analyst.
    const persistedAuditLog = includePayloads ? codingAgentLogger.readSessionAuditLog(sessionId) : ''
    const detailedLogSection =
      persistedAuditLog ||
      (rawLogs.length > 0
        ? rawLogs
            .map((entry) =>
              [
                `### Step ${entry.step} — Tool: \`${entry.tool}\``,
                '```text',
                includePayloads ? stripAnsi(String(entry.output || '')) : `[payload omitted; ${String(entry.output || '').length} chars]`,
                '```',
              ].join('\n'),
            )
            .join('\n\n')
        : 'Nessun dettaglio cronologico persistito per questa sessione.')

    // 6. Plan Milestones State
    const milestones = sessionState?.planMilestones || []
    let planSummary = 'Nessun piano formalizzato per questa sessione.'
    if (milestones.length > 0) {
      const completed = milestones.filter((m) => m.status === 'verified').length
      const lines = milestones.map((m, idx) => {
        const icon = m.status === 'verified' ? '[x]' : m.status === 'in_progress' ? '[>]' : m.status === 'failed' ? '[!]' : '[ ]'
        return includePayloads
          ? `${idx + 1}. ${icon} **${m.title}** (Status: ${m.status.toUpperCase()})${m.notes ? ` — *${m.notes}*` : ''}`
          : `${idx + 1}. ${icon} **${m.id}** (Status: ${m.status.toUpperCase()})`
      })
      planSummary = `Progresso: **${completed}/${milestones.length} (${Math.round((completed / milestones.length) * 100)}%)**\n${lines.join('\n')}`
    }

    // 7. Compile the Final Markdown Bundle
    const rawUserPrompt = sessionState?.userTask || sessionState?.initialUserTask || 'N/A'
    const userPrompt = includePayloads ? rawUserPrompt : `[payload omitted; ${rawUserPrompt.length} chars]`
    const agentMode = sessionState?.agentMode || 'GUIDED'
    const runtime = sessionState?.ollamaRuntimeProfile
    const lastVerification = sessionState?.lastVerification
    const telemetry = sessionState?.ollamaGenerationTelemetry || []
    const telemetryRows = telemetry
      .slice(-20)
      .map(
        (item) => `| ${item.step} | ${item.model} | ${item.numCtx} | ${item.wallDurationMs} | ${item.promptTokens ?? '-'} | ${item.completionTokens ?? '-'} |`,
      )
    const recovery = sessionState?.recoveryFailures
    const recoverySummary = [
      `- **Schema:** ${recovery?.schema?.totalFailures || 0}/${MAX_FAILURES_PER_RECOVERY_CATEGORY}`,
      `- **Execution:** ${recovery?.execution?.totalFailures || 0}/${MAX_FAILURES_PER_RECOVERY_CATEGORY}`,
      `- **Verification:** ${recovery?.verificationFixCycles || 0}/${MAX_VERIFICATION_FIX_CYCLES}`,
    ].join('\n')
    const verificationSummary = lastVerification
      ? [
          `- **Status:** ${lastVerification.status}`,
          `- **Checked at:** ${lastVerification.checkedAt}`,
          `- **Command:** ${includePayloads ? lastVerification.command || 'Unavailable' : '[omitted]'}`,
          `- **Evidence level:** ${lastVerification.evidenceLevel || 'None'}`,
          lastVerification.detail ? `- **Detail:** ${includePayloads ? lastVerification.detail : '[omitted]'}` : '',
        ]
          .filter(Boolean)
          .join('\n')
      : '- **Status:** not run'
    const runtimeSummary = runtime
      ? [
          `- **Pinned model:** \`${runtime.model}\``,
          `- **Model digest:** \`${runtime.digest || 'Unavailable'}\``,
          `- **Ollama endpoint:** \`${includePayloads ? runtime.host : '[omitted]'}\``,
          `- **Runtime options:** num_ctx=${runtime.options.num_ctx}, num_predict=${runtime.options.num_predict}, temperature=${runtime.options.temperature}`,
        ].join('\n')
      : '- No pinned runtime profile was persisted.'
    const telemetryTable =
      telemetryRows.length > 0
        ? ['| Step | Model | num_ctx | Wall ms | Prompt tokens | Output tokens |', '|:---:|:---|---:|---:|---:|---:|', ...telemetryRows].join('\n')
        : 'No generation telemetry was persisted.'

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
- **Active Workspace:** \`${includePayloads ? workspacePath || 'Standalone' : '[omitted]'}\`
- **Active Skills:** ${activeSkills.length > 0 ? activeSkills.map((s) => `\`${s}\``).join(', ') : 'None'}
- **Session ID:** \`${sessionId}\`

### Reproducible Ollama Runtime
${runtimeSummary}

### Generation Telemetry (last 20 turns)
${telemetryTable}

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
- **Status Git Files:** ${gitStatusLines.length > 0 ? (includePayloads ? gitStatusLines.join(', ') : `${gitStatusLines.length} changed path(s)`) : 'None'}
- **Diff Unificato:**
${gitDiffBlock}

---

## 7. Execution Plan & Milestones State
${planSummary}

---

## 8. Application Outcome & Verification
- **Execution phase:** ${sessionState?.executionPhase || 'Unavailable'}
- **Completion status:** ${sessionState?.completionStatus || 'IN_PROGRESS'}
- **Stop reason:** ${sessionState?.terminationReason || 'None'}

### Last Verification
${verificationSummary}

### Recovery Budgets
${recoverySummary}

---
*Fine del Debug Diagnostic Bundle.*
`

    return redactSecrets(bundle)
  }
}

export const aiDebugBundleService = new AiDebugBundleService()
