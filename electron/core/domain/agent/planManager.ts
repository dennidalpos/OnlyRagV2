export interface PlanTask {
  id: number
  title: string
  completed: boolean
  files?: string[]
  instructions?: string
  verificationCommand?: string
  successCriteria?: string
  rawMarkdown: string
}

export interface PlanDocument {
  title: string
  scopeSummary?: string
  tasks: PlanTask[]
  globalVerificationCommand?: string
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

export class PlanManager {
  /**
   * Parses markdown text in .assistant/plan.md format into a structured PlanDocument.
   */
  public static parsePlanMarkdown(markdown: string): PlanDocument {
    if (!markdown || !markdown.trim()) {
      return { title: 'Execution Plan', tasks: [] }
    }

    const lines = markdown.split(/\r?\n/)
    let title = 'Execution Plan'
    let scopeSummary = ''
    const tasks: PlanTask[] = []
    let globalVerificationCommand: string | undefined

    let currentTask: Partial<PlanTask> | null = null
    let taskLines: string[] = []
    let taskIdCounter = 1

    const finalizeCurrentTask = () => {
      if (currentTask && currentTask.title) {
        tasks.push({
          id: currentTask.id || taskIdCounter++,
          title: currentTask.title,
          completed: Boolean(currentTask.completed),
          files: currentTask.files,
          instructions: currentTask.instructions,
          verificationCommand: currentTask.verificationCommand,
          successCriteria: currentTask.successCriteria,
          rawMarkdown: taskLines.join('\n'),
        })
      }
      currentTask = null
      taskLines = []
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const trimmed = line.trim()

      if (trimmed.startsWith('# ') && title === 'Execution Plan') {
        title = trimmed.replace(/^#\s+/, '').replace(/^Implementation Plan:\s*/i, '').trim()
        continue
      }

      if (trimmed.toLowerCase().startsWith('- **global command:**') || trimmed.toLowerCase().startsWith('- **global verification:**')) {
        globalVerificationCommand = trimmed.replace(/-\s+\*\*.*?\*\*:?\s*/i, '').replace(/`/g, '').trim()
        continue
      }

      // Detect checklist item
      const taskMatch = trimmed.match(/^-\s*\[([ xX])\]\s*(?:\*\*)?(?:Task\s*\d+:?\s*)?(.*?)(?:\*\*)?$/i)
      if (taskMatch) {
        finalizeCurrentTask()
        const isCompleted = taskMatch[1].toLowerCase() === 'x'
        const rawTitle = taskMatch[2].replace(/\*\*$/g, '').trim()

        currentTask = {
          id: taskIdCounter++,
          title: rawTitle || `Task ${taskIdCounter}`,
          completed: isCompleted,
        }
        taskLines.push(line)
        continue
      }

      if (currentTask) {
        taskLines.push(line)
        const fileMatch = trimmed.match(/-\s*\*\*Files:\*\*\s*(.*)/i)
        if (fileMatch) {
          currentTask.files = fileMatch[1]
            .split(',')
            .map((f) => f.replace(/`/g, '').trim())
            .filter(Boolean)
          continue
        }

        const instrMatch = trimmed.match(/-\s*\*\*Instructions:\*\*\s*(.*)/i)
        if (instrMatch) {
          currentTask.instructions = instrMatch[1].trim()
          continue
        }

        const verifyMatch = trimmed.match(/-\s*\*\*Verification Command:\*\*\s*(.*)/i)
        if (verifyMatch) {
          currentTask.verificationCommand = verifyMatch[1].replace(/`/g, '').trim()
          continue
        }

        const successMatch = trimmed.match(/-\s*\*\*Success Criteria:\*\*\s*(.*)/i)
        if (successMatch) {
          currentTask.successCriteria = successMatch[1].trim()
          continue
        }
      } else if (trimmed.startsWith('## 1.') || trimmed.startsWith('## Architectural Summary')) {
        scopeSummary = lines.slice(i + 1, i + 4).join(' ').trim()
      }
    }

    finalizeCurrentTask()

    return {
      title,
      scopeSummary: scopeSummary || undefined,
      tasks,
      globalVerificationCommand,
    }
  }

  /**
   * Generates formatted markdown for a PlanDocument.
   */
  public static serializePlanMarkdown(plan: PlanDocument): string {
    const lines: string[] = [`# Implementation Plan: ${plan.title}`, '']

    if (plan.scopeSummary) {
      lines.push('## 1. Architectural Summary & Scope', plan.scopeSummary, '')
    }

    lines.push('## 2. Execution Checklist')
    for (const task of plan.tasks) {
      const mark = task.completed ? 'x' : ' '
      lines.push(`- [${mark}] **Task ${task.id}: ${task.title}**`)
      if (task.files && task.files.length > 0) {
        lines.push(`  - **Files:** ${task.files.map((f) => `\`${f}\``).join(', ')}`)
      }
      if (task.instructions) {
        lines.push(`  - **Instructions:** ${task.instructions}`)
      }
      if (task.verificationCommand) {
        lines.push(`  - **Verification Command:** \`${task.verificationCommand}\``)
      }
      if (task.successCriteria) {
        lines.push(`  - **Success Criteria:** ${task.successCriteria}`)
      }
      lines.push('')
    }

    if (plan.globalVerificationCommand) {
      lines.push('## 3. Final Verification', `- **Global Command:** \`${plan.globalVerificationCommand}\``, '')
    }

    return lines.join('\n')
  }

  /**
   * Generates formatted markdown for .assistant/SESSION_TRACKER.md adhering to compaction rules.
   */
  public static generateSessionTrackerMarkdown(state: CompactPlanState): string {
    const lines: string[] = [
      '# SESSION TRACKER',
      '',
      '## Objective',
      state.objective || 'General Execution Objective',
      '',
      '## Restore Point',
      state.restorePoint || 'None (Session Initialized)',
      '',
      '## Active Micro-Task',
      state.activeMicroTask || 'None (Plan Completed)',
      '',
      '## Remaining Micro-Tasks',
    ]

    if (state.pendingMicroTasks.length === 0) {
      lines.push('- None')
    } else {
      for (const task of state.pendingMicroTasks) {
        lines.push(`- [ ] ${task}`)
      }
    }

    lines.push(
      '',
      '---',
      "[STOP DIRECTIVE]: Upon completing the last micro-task, write the final summary into the .assistant\\SESSION_TRACKER.md file, clearing out the pending task list. Immediately after, halt any automatic execution and write in the chat: 'WAITING FOR COMMAND: Plan completed. State saved and compacted. Awaiting instructions.'. Stop strictly here."
    )

    return lines.join('\n')
  }

  /**
   * Computes a compact plan state representation from a PlanDocument.
   */
  public static getCompactState(plan: PlanDocument, customObjective?: string, overrideRestorePoint?: string): CompactPlanState {
    const totalCount = plan.tasks.length
    const completedTasks = plan.tasks.filter((t) => t.completed)
    const pendingTasks = plan.tasks.filter((t) => !t.completed)
    const completedCount = completedTasks.length
    const isCompleted = totalCount > 0 && pendingTasks.length === 0

    const lastCompletedTask = completedTasks.length > 0 ? completedTasks[completedTasks.length - 1] : null
    const restorePoint = overrideRestorePoint || (lastCompletedTask ? `Task ${lastCompletedTask.id}: ${lastCompletedTask.title}` : 'None (Session Initialized)')

    const activeTask = pendingTasks.length > 0 ? pendingTasks[0] : null
    const activeMicroTask = activeTask ? `Task ${activeTask.id}: ${activeTask.title}` : 'None (Plan Completed)'

    const pendingMicroTasks = pendingTasks.map((t) => `Task ${t.id}: ${t.title}`)

    return {
      objective: customObjective || plan.title || 'Execution Plan',
      restorePoint,
      activeMicroTask,
      pendingMicroTasks,
      completedCount,
      totalCount,
      isCompleted,
    }
  }

  /**
   * Returns the first uncompleted task in the plan.
   */
  public static getNextPendingTask(plan: PlanDocument): PlanTask | null {
    return plan.tasks.find((t) => !t.completed) || null
  }

  /**
   * Returns true if all tasks in the plan are marked as completed.
   */
  public static isPlanComplete(plan: PlanDocument): boolean {
    return plan.tasks.length > 0 && plan.tasks.every((t) => t.completed)
  }

  /**
   * Marks a specific task as completed by ID.
   */
  public static markTaskCompleted(plan: PlanDocument, taskId: number): PlanDocument {
    return {
      ...plan,
      tasks: plan.tasks.map((t) => (t.id === taskId ? { ...t, completed: true } : t)),
    }
  }
}
