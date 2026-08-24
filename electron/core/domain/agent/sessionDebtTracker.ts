/** What a session that stopped without finishing has to be able to tell the user. */
export interface SessionStopReport {
  /** Why the run ended, in plain words. Never an internal directive aimed at the model. */
  reason: string
  stepCount: number
  /** Milestone lines already formatted by the caller ("m-2: Create vite.config.ts"). */
  completed: readonly string[]
  outstanding: readonly string[]
  modifiedFiles: readonly string[]
}

const MAX_LISTED_ITEMS = 8

function listSection(heading: string, items: readonly string[]): string[] {
  if (items.length === 0) return []
  const shown = items.slice(0, MAX_LISTED_ITEMS).map((item) => `- ${item}`)
  if (items.length > MAX_LISTED_ITEMS) shown.push(`- …and ${items.length - MAX_LISTED_ITEMS} more`)
  return ['', heading, ...shown]
}

/**
 * The report a user gets when a session is stopped by a guard rather than by the model's own
 * `finish` call.
 *
 * These paths used to surface the guard's internal `suggestedAction` — the sentence written to
 * steer the MODEL — as the session's final summary. In coding_agent_audit.log
 * session-1787562597025-q8a5 the user's whole account of a 45-step run was "Forcing execution
 * pause. Proceed immediately to applying file changes or call finish tool.": an instruction
 * addressed to someone else, naming no milestone, no file and no cause.
 *
 * Everything here is already known at the moment of the stop. Not producing it was the only
 * thing missing.
 */
export function compileSessionStopSummary(report: SessionStopReport): string {
  const lines: string[] = [
    `⛔ Sessione interrotta automaticamente al passo ${report.stepCount}.`,
    '',
    `Motivo: ${report.reason}`,
  ]

  lines.push(
    ...listSection(`✅ Completato (${report.completed.length}):`, report.completed),
    ...listSection(`⏳ Rimasto aperto (${report.outstanding.length}):`, report.outstanding),
    ...listSection(`📄 File creati o modificati (${report.modifiedFiles.length}):`, report.modifiedFiles)
  )

  if (report.completed.length === 0 && report.modifiedFiles.length === 0) {
    lines.push('', 'Nessuna modifica è stata scritta sul workspace durante questa sessione.')
  }

  return lines.join('\n')
}

export interface SessionReportData {
  sessionId?: string
  lastUpdated?: string
  completedTasks: string[]
  unresolvedIssues: string[]
  modifiedFiles: string[]
  nextSteps: string[]
  summaryText?: string
}

export class SessionDebtTracker {
  private data: SessionReportData = {
    completedTasks: [],
    unresolvedIssues: [],
    modifiedFiles: [],
    nextSteps: [],
  }

  constructor(initialData?: Partial<SessionReportData>) {
    if (initialData) {
      this.data = {
        sessionId: initialData.sessionId,
        lastUpdated: initialData.lastUpdated || new Date().toISOString(),
        completedTasks: initialData.completedTasks ? [...initialData.completedTasks] : [],
        unresolvedIssues: initialData.unresolvedIssues ? [...initialData.unresolvedIssues] : [],
        modifiedFiles: initialData.modifiedFiles ? [...initialData.modifiedFiles] : [],
        nextSteps: initialData.nextSteps ? [...initialData.nextSteps] : [],
        summaryText: initialData.summaryText,
      }
    }
  }

  public getData(): Readonly<SessionReportData> {
    return this.data
  }

  public updateReport(newData: Partial<SessionReportData>): void {
    this.data = {
      ...this.data,
      ...newData,
      lastUpdated: new Date().toISOString(),
    }
  }

  public compileTrackerMarkdown(): string {
    const timestamp = this.data.lastUpdated || new Date().toISOString()
    const lines: string[] = [
      '# SESSION TRACKER & UNRESOLVED DEBT REPORT',
      `*Last Updated:* ${timestamp}`,
      '',
      '## 1. Functional Changes & Completed Tasks',
    ]

    if (this.data.completedTasks.length === 0) {
      lines.push('- No tasks completed yet.')
    } else {
      this.data.completedTasks.forEach((task) => lines.push(`- [x] ${task}`))
    }

    lines.push('', '## 2. Modified & Created Files')
    if (this.data.modifiedFiles.length === 0) {
      lines.push('- None.')
    } else {
      this.data.modifiedFiles.forEach((file) => lines.push(`- \`${file}\``))
    }

    lines.push('', '## 3. Unresolved Issues, Errors & Known Debt')
    if (this.data.unresolvedIssues.length > 0) {
      this.data.unresolvedIssues.forEach((issue) => lines.push(`- [!] **BLOCKER/DEBT:** ${issue}`))
    } else if (this.data.nextSteps.length > 0) {
      // "None reported (all verified)" used to print whenever no milestone carried the `failed`
      // status — which is not the same thing as being done. In session-1787562597025-q8a5 the
      // tracker made that claim over a failed run with fourteen of fifteen milestones still
      // open, because none of them had been explicitly marked failed. Open work is debt.
      lines.push(
        `- [!] No explicit blocker was recorded, but ${this.data.nextSteps.length} milestone(s) are still open — see section 4.`
      )
    } else {
      lines.push('- None reported (all verified).')
    }

    lines.push('', '## 4. Next Recommended Steps')
    if (this.data.nextSteps.length === 0) {
      lines.push('- No immediate follow-ups.')
    } else {
      this.data.nextSteps.forEach((step) => lines.push(`- [ ] ${step}`))
    }

    if (this.data.summaryText) {
      lines.push('', '## 5. Raw Agent Summary', this.data.summaryText)
    }

    return lines.join('\n')
  }

  public compilePromptBlock(): string {
    // Gate on what this block actually renders. summaryText used to count as content, but
    // nothing below prints it -- and parseTrackerMarkdown sets it to the whole file, so any
    // tracker on disk produced a bare "### PERSISTENT SESSION TRACKER" heading with nothing
    // under it in every single turn's prompt (see coding_agent_audit.log, every step).
    if (this.data.completedTasks.length === 0 && this.data.unresolvedIssues.length === 0) {
      return ''
    }

    const lines: string[] = [
      '### PERSISTENT SESSION TRACKER (Previous Turn History & Debt)',
    ]

    if (this.data.unresolvedIssues.length > 0) {
      lines.push('⚠️ **KNOWN UNRESOLVED BUGS / DEBT FROM PREVIOUS TURN:**')
      this.data.unresolvedIssues.forEach((issue) => lines.push(`- [!] ${issue}`))
    }

    if (this.data.completedTasks.length > 0) {
      lines.push('✅ **PREVIOUSLY COMPLETED WORK:**')
      this.data.completedTasks.forEach((task) => lines.push(`- [x] ${task}`))
    }

    // nextSteps is deliberately NOT rendered here. It is the list of still-pending milestones,
    // which the prompt already carries verbatim in the STRUCTURED EXECUTION PLAN block - echoing
    // it a second time cost ~1.5k chars per turn to tell the model something it had just read.
    // It stays in the persisted SESSION_TRACKER.md (compileTrackerMarkdown) for session resume.

    return lines.join('\n')
  }

  public static parseTrackerMarkdown(markdown: string): SessionDebtTracker {
    if (!markdown || !markdown.trim()) {
      return new SessionDebtTracker()
    }

    const completedTasks: string[] = []
    const unresolvedIssues: string[] = []
    const modifiedFiles: string[] = []
    const nextSteps: string[] = []

    const lines = markdown.split(/\r?\n/)
    let currentSection = ''

    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (line.startsWith('## 1.')) {
        currentSection = 'completed'
        continue
      } else if (line.startsWith('## 2.')) {
        currentSection = 'files'
        continue
      } else if (line.startsWith('## 3.')) {
        currentSection = 'unresolved'
        continue
      } else if (line.startsWith('## 4.')) {
        currentSection = 'next'
        continue
      } else if (line.startsWith('## 5.')) {
        currentSection = 'raw'
        continue
      }

      if (line.startsWith('- ') || line.startsWith('* ')) {
        const item = line.replace(/^[-*]\s+(\[x\]|\[!\]|\[ \])?\s*/i, '').trim()
        if (!item || item.toLowerCase().startsWith('none') || item.toLowerCase().startsWith('no tasks')) continue

        if (currentSection === 'completed') {
          completedTasks.push(item)
        } else if (currentSection === 'files') {
          modifiedFiles.push(item.replace(/`/g, ''))
        } else if (currentSection === 'unresolved') {
          unresolvedIssues.push(item.replace(/^\*\*BLOCKER\/DEBT:\*\*\s*/i, ''))
        } else if (currentSection === 'next') {
          nextSteps.push(item)
        }
      }
    }

    return new SessionDebtTracker({
      completedTasks,
      unresolvedIssues,
      modifiedFiles,
      nextSteps,
      summaryText: markdown,
    })
  }
}
