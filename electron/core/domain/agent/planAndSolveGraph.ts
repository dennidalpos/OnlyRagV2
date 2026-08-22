export interface PlanMilestone {
  id: string
  title: string
  status: 'pending' | 'in_progress' | 'verified' | 'failed'
  falsifiableHypothesis?: string
  verificationCommand?: string
  notes?: string
}

export interface CompactPlanState {
  objective: string
  restorePoint: string
  activeMicroTask: string
  pendingMicroTasks: string[]
  completedCount: number
  totalCount: number
  isCompleted: boolean
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

  /**
   * Replaces the plan with a newly emitted one while carrying over the progress already
   * earned: any incoming milestone whose title matches an existing verified/failed one
   * keeps that status. Lets the agent re-plan mid-session (scope discovered late, a
   * milestone that turned out to need splitting) without silently resetting to 0%.
   */
  public replacePlanPreservingProgress(milestones: PlanMilestone[]): void {
    const previousByTitle = new Map<string, PlanMilestone>()
    for (const m of this.milestones) {
      previousByTitle.set(m.title.trim().toLowerCase(), m)
    }

    this.milestones = milestones.map((m, idx) => {
      const previous = previousByTitle.get((m.title || '').trim().toLowerCase())
      const carriedStatus = previous && (previous.status === 'verified' || previous.status === 'failed')
        ? previous.status
        : m.status || 'pending'

      return {
        ...m,
        id: m.id || `milestone-${idx + 1}`,
        status: carriedStatus,
        notes: m.notes || previous?.notes,
      }
    })
  }

  public hasPlan(): boolean {
    return this.milestones.length > 0
  }

  public getActiveMilestone(): PlanMilestone | undefined {
    return this.milestones.find((m) => m.status === 'in_progress') || this.milestones.find((m) => m.status === 'pending')
  }

  /** Same id-or-title-substring lookup updateMilestone uses, exposed so callers can inspect
   *  a milestone (e.g. its verificationCommand) before deciding what status to apply. */
  public findMilestone(idOrIndex: string | number): PlanMilestone | undefined {
    if (typeof idOrIndex === 'number') {
      return this.milestones[idOrIndex]
    }
    return this.milestones.find((m) => m.id === idOrIndex || m.title.toLowerCase().includes(idOrIndex.toLowerCase()))
  }

  public updateMilestone(idOrIndex: string | number, status: PlanMilestone['status'], notes?: string): boolean {
    const target = this.findMilestone(idOrIndex)
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

  public getCompactState(customObjective?: string): CompactPlanState {
    return GoalDecompositionPlanner.getCompactStateFromMilestones(this.milestones, customObjective)
  }

  public static getCompactStateFromMilestones(
    milestones: ReadonlyArray<PlanMilestone>,
    customObjective?: string
  ): CompactPlanState {
    const totalCount = milestones.length
    const completedMilestones = milestones.filter((m) => m.status === 'verified')
    const pendingMilestones = milestones.filter((m) => m.status !== 'verified')
    const completedCount = completedMilestones.length
    const isCompleted = totalCount > 0 && pendingMilestones.length === 0

    const lastCompleted = completedMilestones.length > 0 ? completedMilestones[completedMilestones.length - 1] : null
    const restorePoint = lastCompleted ? `${lastCompleted.id}: ${lastCompleted.title}` : 'None (Session Initialized)'

    const activeMilestone = pendingMilestones.length > 0 ? pendingMilestones[0] : null
    const activeMicroTask = activeMilestone ? `${activeMilestone.id}: ${activeMilestone.title}` : 'None (Plan Completed)'

    const pendingMicroTasks = pendingMilestones.map((m) => `${m.id}: ${m.title}`)

    return {
      objective: customObjective || 'Execution Plan',
      restorePoint,
      activeMicroTask,
      pendingMicroTasks,
      completedCount,
      totalCount,
      isCompleted,
    }
  }

  public getPlanMarkdown(): string {
    if (this.milestones.length === 0) return ''
    const lines: string[] = ['# Execution Plan', '', '## Execution Checklist']
    for (const m of this.milestones) {
      const mark = m.status === 'verified' ? 'x' : ' '
      lines.push(`- [${mark}] **Task ${m.id}: ${m.title}**`)
    }
    return lines.join('\n')
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

    if (progress.completed === progress.total && progress.total > 0) {
      lines.push(
        '\n[ALL CHECKLIST MILESTONES COMPLETED - ACTION REQUIRED]\nAll operational checklist tasks are 100% completed and verified. DO NOT execute any more file edits or commands.\nIMMEDIATELY invoke the "finish" tool and provide a comprehensive final summary report (resoconto finale in the user\'s language) detailing:\n1. Summary of Functional Changes\n2. List of Modified/Created Files\n3. Verification & Test Results\n4. Final Conclusion'
      )
    } else {
      const activeM = this.getActiveMilestone()
      if (activeM) {
        lines.push(
          `\n[CURRENT ACTIVE MICRO-TASK FOCUS]\n🎯 ACTIVE MILESTONE (Focus strictly on this step now):\n👉 **Task ${activeM.id}: ${activeM.title}**\nDirectives:\n1. Execute ONLY the actions required for this specific milestone.\n2. Do NOT jump ahead to subsequent milestones.\n3. Do NOT invoke "finish" until this active milestone and all prior milestones are completed and verified.`
        )
      }
    }

    return lines.join('\n')
  }

  public static parsePlanFromText(text: string): PlanMilestone[] {
    if (!text || typeof text !== 'string') return []

    // Strip thinking tags from reasoning models (e.g. DeepSeek-R1, Qwen) so internal thoughts don't pollute milestones
    const sanitizedText = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()

    // 1. Try extracting <plan>...</plan> JSON or structured checklist
    const planBlockMatch = sanitizedText.match(/<plan>([\s\S]*?)<\/plan>/i)
    const sourceText = planBlockMatch ? planBlockMatch[1] : sanitizedText

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

    // 2. Markdown checklist & micro-task parser with automatic sub-bullet flattening
    const rawLines = sourceText.split(/\r?\n/)
    interface RawBlock {
      topTitle: string
      topStatus: PlanMilestone['status']
      children: Array<{ title: string; status: PlanMilestone['status'] }>
    }

    const blocks: RawBlock[] = []
    let currentBlock: RawBlock | null = null
    let inCodeBlock = false

    for (const rawLine of rawLines) {
      if (rawLine.trim().startsWith('```')) {
        inCodeBlock = !inCodeBlock
        continue
      }
      if (inCodeBlock) continue

      const trimmed = rawLine.trim()
      if (!trimmed || trimmed.startsWith('#')) continue

      const isIndented = /^\s{2,}/.test(rawLine) || rawLine.startsWith('\t')

      if (isIndented && currentBlock) {
        // Match sub-bullet or indented checkbox
        const subMatch = rawLine.match(/^\s*(?:[-*+]|\d+[\.)])\s*(?:\[([ xX>!])\]\s*)?(.+)$/)
        if (subMatch) {
          const flag = (subMatch[1] || '').toLowerCase()
          let status: PlanMilestone['status'] = 'pending'
          if (flag === 'x') status = 'verified'
          else if (flag === '>') status = 'in_progress'
          else if (flag === '!') status = 'failed'
          else if (currentBlock.topStatus !== 'pending') status = currentBlock.topStatus

          const body = subMatch[2].trim().replace(/\*\*/g, '')
          if (body.length > 2 && !body.startsWith('http')) {
            currentBlock.children.push({ title: body, status })
            continue
          }
        }
      }

      // Check top-level checklist item
      const topCheckMatch = trimmed.match(/^(?:[-*+]|\d+[\.)])\s*\[([ xX>!])\]\s*(.+)$/)
      if (topCheckMatch) {
        const flag = (topCheckMatch[1] || '').toLowerCase()
        let status: PlanMilestone['status'] = 'pending'
        if (flag === 'x') status = 'verified'
        else if (flag === '>') status = 'in_progress'
        else if (flag === '!') status = 'failed'

        const body = topCheckMatch[2].trim().replace(/\*\*/g, '')
        currentBlock = { topTitle: body, topStatus: status, children: [] }
        blocks.push(currentBlock)
        continue
      }

      // Check top-level numbered item
      const topNumMatch = trimmed.match(/^(\d+)[\.)]\s+(.+)$/)
      if (topNumMatch) {
        const body = topNumMatch[2].trim().replace(/\*\*/g, '')
        if (body.length > 3 && !body.startsWith('http')) {
          currentBlock = { topTitle: body, topStatus: 'pending', children: [] }
          blocks.push(currentBlock)
          continue
        }
      }

      // Check top-level bullet item
      const topBulletMatch = trimmed.match(/^[-*+]\s+(.+)$/)
      if (topBulletMatch) {
        const body = topBulletMatch[1].trim().replace(/\*\*/g, '')
        if (body.length > 3 && !body.startsWith('http')) {
          currentBlock = { topTitle: body, topStatus: 'pending', children: [] }
          blocks.push(currentBlock)
          continue
        }
      }
    }

    // Flatten blocks into discrete PlanMilestone items
    const milestones: PlanMilestone[] = []
    let counter = 1
    for (const block of blocks) {
      if (block.children.length > 0) {
        for (const child of block.children) {
          milestones.push({
            id: `m-${counter++}`,
            title: child.title,
            status: child.status,
          })
        }
      } else {
        milestones.push({
          id: `m-${counter++}`,
          title: block.topTitle,
          status: block.topStatus,
        })
      }
    }

    return milestones
  }
}
