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
    const lines: string[] = ['# SESSION_TRACKER', 'format: 2', `updated_at: ${timestamp}`, '', '## completed_tasks']
    this.data.completedTasks.forEach((task) => lines.push(`- [x] ${task}`))

    lines.push('', '## modified_files')
    this.data.modifiedFiles.forEach((file) => lines.push(`- \`${file}\``))

    lines.push('', '## unresolved_issues')
    if (this.data.unresolvedIssues.length > 0) {
      this.data.unresolvedIssues.forEach((issue) => lines.push(`- [!] ${issue}`))
    } else if (this.data.nextSteps.length > 0) {
      lines.push(`- [!] open_milestones: ${this.data.nextSteps.length}`)
    }

    lines.push('', '## next_steps')
    this.data.nextSteps.forEach((step) => lines.push(`- [ ] ${step}`))

    if (this.data.summaryText) {
      lines.push('', '## agent_summary', this.data.summaryText)
    }

    return lines.join('\n')
  }

  public compilePromptBlock(): string {
    // Gate on what this block actually renders.
    if (this.data.completedTasks.length === 0 && this.data.unresolvedIssues.length === 0) {
      return ''
    }

    const lines: string[] = ['### SESSION_TRACKER']

    if (this.data.unresolvedIssues.length > 0) {
      lines.push('unresolved_issues:')
      this.data.unresolvedIssues.forEach((issue) => lines.push(`- [!] ${issue}`))
    }

    if (this.data.completedTasks.length > 0) {
      lines.push('completed_tasks:')
      this.data.completedTasks.forEach((task) => lines.push(`- [x] ${task}`))
    }

    // nextSteps is deliberately NOT rendered here.

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
      if (currentSection === 'raw') continue
      if (line === '## completed_tasks' || line.startsWith('## 1.')) {
        currentSection = 'completed'
        continue
      } else if (line === '## modified_files' || line.startsWith('## 2.')) {
        currentSection = 'files'
        continue
      } else if (line === '## unresolved_issues' || line.startsWith('## 3.')) {
        currentSection = 'unresolved'
        continue
      } else if (line === '## next_steps' || line.startsWith('## 4.')) {
        currentSection = 'next'
        continue
      } else if (line === '## agent_summary' || line.startsWith('## 5.')) {
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
          if (!item.startsWith('open_milestones:') && !item.startsWith('No explicit blocker was recorded')) {
            unresolvedIssues.push(item.replace(/^\*\*BLOCKER\/DEBT:\*\*\s*/i, ''))
          }
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
