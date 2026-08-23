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
    if (this.data.unresolvedIssues.length === 0) {
      lines.push('- None reported (all verified).')
    } else {
      this.data.unresolvedIssues.forEach((issue) => lines.push(`- [!] **BLOCKER/DEBT:** ${issue}`))
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
    if (
      this.data.completedTasks.length === 0 &&
      this.data.unresolvedIssues.length === 0 &&
      !this.data.summaryText
    ) {
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
