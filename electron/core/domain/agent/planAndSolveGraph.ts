export interface PlanMilestone {
  id: string
  title: string
  status: 'pending' | 'in_progress' | 'verified' | 'failed'
  falsifiableHypothesis?: string
  verificationCommand?: string
  notes?: string
}

export class GoalDecompositionPlanner {
  private milestones: PlanMilestone[] = []

  public initializePlan(milestones: PlanMilestone[]): void {
    this.milestones = milestones.map((m, idx) => ({
      ...m,
      id: m.id || `milestone-${idx + 1}`,
      status: m.status || 'pending',
    }))
  }

  public loadMilestones(milestones: PlanMilestone[]): void {
    this.milestones = milestones ? [...milestones] : []
  }

  public getMilestones(): ReadonlyArray<PlanMilestone> {
    return this.milestones
  }

  public hasPlan(): boolean {
    return this.milestones.length > 0
  }

  public getActiveMilestone(): PlanMilestone | undefined {
    return this.milestones.find((m) => m.status === 'in_progress') || this.milestones.find((m) => m.status === 'pending')
  }

  public updateMilestone(idOrIndex: string | number, status: PlanMilestone['status'], notes?: string): boolean {
    let target: PlanMilestone | undefined
    if (typeof idOrIndex === 'number') {
      target = this.milestones[idOrIndex]
    } else {
      target = this.milestones.find((m) => m.id === idOrIndex || m.title.toLowerCase().includes(idOrIndex.toLowerCase()))
    }

    if (!target) return false

    target.status = status
    if (notes) target.notes = notes
    return true
  }

  public isAllVerified(): boolean {
    return this.milestones.length > 0 && this.milestones.every((m) => m.status === 'verified')
  }

  public getProgressSummary(): { completed: number; total: number; percentage: number } {
    const total = this.milestones.length
    if (total === 0) return { completed: 0, total: 0, percentage: 0 }
    const completed = this.milestones.filter((m) => m.status === 'verified').length
    return {
      completed,
      total,
      percentage: Math.round((completed / total) * 100),
    }
  }

  public compileProgressPrompt(): string {
    if (this.milestones.length === 0) return ''

    const progress = this.getProgressSummary()
    const lines = [
      `### STRUCTURED EXECUTION PLAN (${progress.completed}/${progress.total} verified - ${progress.percentage}%)`,
      'Execute systematically. Mark milestones verified only when validated.',
    ]

    for (const [idx, m] of this.milestones.entries()) {
      let icon = '[ ]'
      if (m.status === 'verified') icon = '[x]'
      else if (m.status === 'in_progress') icon = '[>]'
      else if (m.status === 'failed') icon = '[!]'

      let line = `${idx + 1}. ${icon} **${m.title}**`
      if (m.falsifiableHypothesis) {
        line += ` — *Hypothesis:* ${m.falsifiableHypothesis}`
      }
      if (m.verificationCommand) {
        line += ` — *Verify with:* \`${m.verificationCommand}\``
      }
      if (m.notes) {
        line += ` (Note: ${m.notes})`
      }
      lines.push(line)
    }

    return lines.join('\n')
  }

  public static parsePlanFromText(text: string): PlanMilestone[] {
    if (!text || typeof text !== 'string') return []

    const milestones: PlanMilestone[] = []

    // 1. Try extracting <plan>...</plan> JSON or structured checklist
    const planBlockMatch = text.match(/<plan>([\s\S]*?)<\/plan>/i)
    const sourceText = planBlockMatch ? planBlockMatch[1] : text

    // Check for JSON array inside plan block
    const jsonMatch = sourceText.match(/\[\s*\{[\s\S]*\}\s*\]/)
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0])
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((item: any, idx: number) => ({
            id: item.id || `m-${idx + 1}`,
            title: item.title || item.step || item.name || `Milestone ${idx + 1}`,
            status: (item.status as any) || 'pending',
            falsifiableHypothesis: item.falsifiableHypothesis || item.hypothesis || undefined,
            verificationCommand: item.verificationCommand || item.verify || undefined,
          }))
        }
      } catch {}
    }

    // 2. Markdown checklist parser e.g. "- [ ] Step 1", "1. [ ] Step 1", or "1. Step 1"
    const lines = sourceText.split(/\r?\n/)
    let counter = 1

    for (const rawLine of lines) {
      const line = rawLine.trim()
      const checkMatch = line.match(/^(?:[-*]|\d+\.)\s*\[([ xX>!])\]\s*(.+)$/)
      if (checkMatch) {
        const flag = checkMatch[1].toLowerCase()
        const body = checkMatch[2].trim()
        let status: PlanMilestone['status'] = 'pending'
        if (flag === 'x') status = 'verified'
        else if (flag === '>') status = 'in_progress'
        else if (flag === '!') status = 'failed'

        milestones.push({
          id: `m-${counter++}`,
          title: body.replace(/\*\*/g, ''),
          status,
        })
        continue
      }

      const numMatch = line.match(/^(\d+)\.\s+(.+)$/)
      if (numMatch && !line.includes('```')) {
        const body = numMatch[2].trim()
        if (body.length > 5 && !body.startsWith('http')) {
          milestones.push({
            id: `m-${counter++}`,
            title: body.replace(/\*\*/g, ''),
            status: 'pending',
          })
        }
      }
    }

    return milestones
  }
}
