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

/**
 * Recognises the plan's own closing milestone (the "write the final report and stop" entry
 * the planner appends). It is the one milestone the finish tool owns: nothing else may mark
 * it verified, and the Definition of Done gate must not count it as outstanding work.
 */
export function isCompletionMilestoneTitle(title: string): boolean {
  return /finish|completamento|arresto|riepilogo|final report/i.test(title || '')
}

/** One milestone changing status, emitted so callers can record who moved it and why. */
export interface MilestoneTransition {
  id: string
  title: string
  from: PlanMilestone['status']
  to: PlanMilestone['status']
  cause: string
}

export class GoalDecompositionPlanner {
  private milestones: PlanMilestone[] = []
  private transitionListener?: (transition: MilestoneTransition) => void

  /**
   * Registers a listener notified whenever a milestone's status actually changes.
   *
   * The planner stays free of any logging dependency — it only announces the change, and the
   * application layer decides what to do with it. Answering "which step closed this milestone,
   * and on what grounds?" previously meant diffing full plan snapshots by hand.
   */
  public onMilestoneTransition(listener: (transition: MilestoneTransition) => void): void {
    this.transitionListener = listener
  }

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

    const previousStatus = target.status
    target.status = status
    if (notes) target.notes = notes

    if (previousStatus !== status) {
      this.transitionListener?.({
        id: target.id,
        title: target.title,
        from: previousStatus,
        to: status,
        cause: notes || target.notes || 'No cause recorded.',
      })
    }
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

      // Render the id explicitly: titles no longer carry a self-label (see stripRedundantIdPrefix),
      // and the model needs the canonical id here to address a milestone via "update_plan".
      let line = `${idx + 1}. ${icon} **${m.id}: ${m.title}**`
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

    const activeM = this.getActiveMilestone()
    const failedMilestones = this.milestones.filter((m) => m.status === 'failed')

    if (progress.completed === progress.total && progress.total > 0) {
      lines.push(
        '\n[ALL CHECKLIST MILESTONES COMPLETED - ACTION REQUIRED]\nAll operational checklist tasks are 100% completed and verified. DO NOT execute any more file edits or commands.\nIMMEDIATELY invoke the "finish" tool and provide a comprehensive final summary report (resoconto finale in the user\'s language) detailing:\n1. Summary of Functional Changes\n2. List of Modified/Created Files\n3. Verification & Test Results\n4. Final Conclusion'
      )
    } else if (!activeM || isCompletionMilestoneTitle(activeM.title)) {
      // Every milestone that could still be worked on is done or abandoned, and only the
      // closing milestone is left. The generic branch below would be self-contradictory here:
      // it renders "Task m-N: ... invoke finish" as the active milestone while its own
      // directive 4 forbids finishing until everything is verified -- which abandoned
      // milestones make permanently false. Faced with no legal move the model asked a
      // question instead, and the session died as STOPPED/FAILED (session-1787471833056-o5fk,
      // step 45). Abandoned work is reported in the final summary, not used to block it.
      const failedList = failedMilestones.length > 0
        ? `\nThe following milestones were abandoned and MUST be reported as incomplete in your summary:\n${failedMilestones.map((m) => `- ${m.id}: ${m.title}`).join('\n')}`
        : ''
      lines.push(
        `\n[NO OPERATIONAL MILESTONES REMAIN - ACTION REQUIRED]\nEvery milestone that can still be worked on is either verified or abandoned. DO NOT execute any more file edits or commands, and DO NOT ask the user a question.\nIMMEDIATELY invoke the "finish" tool with a comprehensive final report (in the user's language) detailing:\n1. Summary of Functional Changes\n2. List of Modified/Created Files\n3. Verification & Test Results\n4. Work left incomplete and why\n5. Final Conclusion${failedList}`
      )
    } else {
      lines.push(
        `\n[CURRENT ACTIVE MICRO-TASK FOCUS]\n🎯 ACTIVE MILESTONE (Focus on this step now):\n👉 **Task ${activeM.id}: ${activeM.title}**\nDirectives:\n1. Focus your actions on achieving the goals of this milestone.\n2. Once the required files for this milestone are created or updated, invoke "update_plan" to mark it verified or proceed directly to the next milestone.\n3. Never repeat identical file writes or commands in a loop. If configuration or boilerplate files are already created, advance immediately to implementing components in src/.\n4. Do NOT invoke "finish" until all operational checklist milestones are completed and verified.\n5. AUTO-ADAPTATION DIRECTIVE: If any CLI scaffolding command fails or hangs, construct the required project files directly using write_file (e.g. package.json, vite.config.ts, index.html, src/App.tsx) directly in the workspace root.`
      )
    }

    return lines.join('\n')
  }

  /**
   * Planner models routinely emit their own "m-3: " / "3. " label inside the milestone title.
   * Callers then prefix the canonical id again, so prompts rendered "Task m-1: m-1: Create ..."
   * — duplicated noise in the plan block, the active-milestone focus line and the session
   * tracker, on every single turn. Strip a leading self-label so the id is written exactly once.
   */
  private static stripRedundantIdPrefix(title: string): string {
    if (!title) return title
    // Deliberately narrow: only an `m-N` / `milestone N` self-label, which is the canonical id
    // form this class emits and therefore the one that actually doubles up. Prefixes like
    // "Step 1: " are the model's own prose and are left intact.
    const stripped = title.replace(/^\s*(?:m[-_]?\d+|milestone\s*\d+)\s*[:.)-]\s+/i, '').trim()
    return stripped || title.trim()
  }

  /**
   * Pulls a trailing verification directive off a checklist line.
   *
   * The JSON plan payload has always carried `verificationCommand`, but a plan drafted as a
   * markdown checklist — which is what the planning prompt actually asks for, and what the
   * user edits by hand — had no way to express one: the field only ever survived the JSON
   * path, so `update_plan` fell back to trusting the model's own claim that a milestone was
   * done. A checklist line can now say how it is proven, in the form the planning prompt
   * mandates: `- [ ] m-4: Create \`src/App.tsx\` — verify: \`npm run build\``.
   *
   * Recognised endings (case-insensitive, `verifica`/`verification` accepted alongside
   * `verify`, since the plan is written in the user's language):
   *   `— verify: npm run build`   `(verify: npm run build)`   `[verifica: npm test]`
   */
  private static extractVerificationDirective(title: string): { title: string; verificationCommand?: string } {
    if (!title) return { title }

    // Emphasis markers are tolerated around the keyword because getPlanMarkdown renders the
    // directive as "— *Verify with:* `cmd`", and that rendered plan is exactly what the user
    // edits by hand and sends back through this parser: without this the field would be lost
    // on every round trip through the UI.
    const KEYWORD = '[*_]{0,2}\\s*(?:verify with|verified by|verificato con|verification|verifica|verify)\\s*[:=]\\s*[*_]{0,2}\\s*'
    const PATTERNS = [
      // Bracketed: "... (verify: npm run build)" / "... [verifica: npm test]"
      new RegExp(`\\s*[([]\\s*${KEYWORD}([^)\\]]+?)\\s*[)\\]]\\s*$`, 'i'),
      // Separated by a dash or sentence punctuation: "... — verify: npm run build"
      new RegExp(`\\s*(?:[—–]|--|-|;|,|\\.)\\s*${KEYWORD}(.+?)\\s*$`, 'i'),
    ]

    for (const pattern of PATTERNS) {
      const match = title.match(pattern)
      if (!match) continue
      // Backticks/quotes are markdown decoration around the command, never part of it.
      const command = match[1].replace(/^[`'"*_]+|[`'"*_.]+$/g, '').trim()
      const remainingTitle = title.slice(0, match.index).trim()
      // A line that is ONLY a verification directive still has to keep a title, so an
      // over-eager match that would empty it is discarded rather than applied.
      if (!command || !remainingTitle) continue
      return { title: remainingTitle, verificationCommand: command }
    }

    return { title }
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
            title: this.stripRedundantIdPrefix(item.title || item.step || item.name || `Milestone ${idx + 1}`),
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

    for (const rawLine of rawLines) {
      const trimmed = rawLine.trim()
      // Skip markdown code fence delimiters (```markdown, ```, etc.) without discarding plan lines inside
      if (trimmed.startsWith('```')) continue
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
      const entries = block.children.length > 0
        ? block.children
        : [{ title: block.topTitle, status: block.topStatus }]

      for (const entry of entries) {
        const { title, verificationCommand } = this.extractVerificationDirective(entry.title)
        milestones.push({
          id: `m-${counter++}`,
          title: this.stripRedundantIdPrefix(title),
          status: entry.status,
          verificationCommand,
        })
      }
    }

    return milestones
  }
}
