import type { SkillDefinition } from './skillTypes'

const STOP_WORDS = new Set([
  'about', 'above', 'after', 'again', 'against', 'all', 'and', 'any', 'because',
  'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by', 'could',
  'did', 'does', 'doing', 'down', 'during', 'each', 'few', 'for', 'from', 'further',
  'had', 'has', 'have', 'having', 'her', 'here', 'hers', 'herself', 'him', 'himself',
  'his', 'how', 'into', 'its', 'itself', 'just', 'more', 'most', 'myself', 'nor',
  'not', 'now', 'off', 'once', 'only', 'other', 'our', 'ours', 'ourselves', 'out',
  'over', 'own', 'same', 'should', 'some', 'such', 'than', 'that', 'the', 'their',
  'theirs', 'them', 'themselves', 'then', 'there', 'these', 'they', 'this', 'those',
  'through', 'too', 'under', 'until', 'very', 'was', 'were', 'what', 'when', 'where',
  'which', 'while', 'who', 'whom', 'why', 'with', 'would', 'guideline', 'guidelines',
  'pattern', 'patterns', 'standard', 'standards',
])

function matchesWordOrPhrase(text: string, term: string): boolean {
  const clean = term.toLowerCase().trim()
  if (!clean) return false
  if (clean.includes(' ') || clean.includes('-') || clean.includes('_')) {
    return text.includes(clean)
  }
  if (clean.length <= 4) {
    const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`(?:^|\\b|\\s)${escaped}(?:\\b|\\s|$)`, 'i')
    return regex.test(text)
  }
  return text.includes(clean)
}

export interface SkillMatchContext {
  userTask: string
  activeFilePath?: string
  activeFileContent?: string
  pinnedFiles?: { path: string; name?: string }[]
  workspacePath?: string
  projectStack?: string[]
}

export function matchSkillsForTask(
  userTaskOrContext: string | SkillMatchContext,
  availableSkills: SkillDefinition[],
  maxSkillsToInject: number = 3
): SkillDefinition[] {
  if (!userTaskOrContext || availableSkills.length === 0) return []

  const userTask = typeof userTaskOrContext === 'string' ? userTaskOrContext : userTaskOrContext.userTask || ''
  if (!userTask && typeof userTaskOrContext === 'string') return []

  const ctx: SkillMatchContext = typeof userTaskOrContext === 'string'
    ? { userTask }
    : userTaskOrContext

  const taskText = ctx.userTask.toLowerCase()
  const projectStack = new Set((ctx.projectStack || []).map((s) => s.toLowerCase()))

  let fileContextText = ''
  if (ctx.activeFilePath) {
    const ext = ctx.activeFilePath.split('.').pop() || ''
    const fileName = ctx.activeFilePath.split(/[\/\\]/).pop() || ''
    fileContextText += ` ${fileName.toLowerCase()} ext:${ext.toLowerCase()} ${ext.toLowerCase()}`
  }
  if (ctx.pinnedFiles && ctx.pinnedFiles.length > 0) {
    for (const pf of ctx.pinnedFiles) {
      const pExt = pf.path.split('.').pop() || ''
      const pName = pf.name || pf.path.split(/[\/\\]/).pop() || ''
      fileContextText += ` ${pName.toLowerCase()} ${pExt.toLowerCase()}`
    }
  }
  if (ctx.workspacePath) {
    const wsName = ctx.workspacePath.split(/[\/\\]/).pop() || ''
    fileContextText += ` workspace:${wsName.toLowerCase()}`
  }
  if (ctx.activeFileContent) {
    const snippet = ctx.activeFileContent.slice(0, 300).toLowerCase().replace(/[^a-z0-9-_]/g, ' ')
    fileContextText += ` ${snippet}`
  }

  const scoredSkills: { skill: SkillDefinition; score: number }[] = []

  for (const skill of availableSkills) {
    let promptScore = 0
    let projectScore = 0

    // --- 1. User Prompt Matching ---
    const skillSlug = skill.name.toLowerCase().replace(/[-_]/g, ' ')
    if (matchesWordOrPhrase(taskText, skillSlug) || matchesWordOrPhrase(taskText, skill.name)) {
      promptScore += 10.0
    }

    for (const trigger of skill.triggers) {
      if (matchesWordOrPhrase(taskText, trigger)) {
        promptScore += 6.0
      }
    }

    for (const tag of skill.tags) {
      if (matchesWordOrPhrase(taskText, tag)) {
        promptScore += 3.0
      }
    }

    const descWords = Array.from(
      new Set(
        skill.description
          .toLowerCase()
          .split(/[^a-z0-9-_]+/)
          .filter((w) => w.length >= 4 && !STOP_WORDS.has(w))
      )
    )

    for (const word of descWords) {
      if (matchesWordOrPhrase(taskText, word)) {
        promptScore += 1.5
      }
    }

    // --- 2. Project Stack & File Context Matching ---
    if (projectStack.size > 0) {
      const skillNameClean = skill.name.toLowerCase()
      if (projectStack.has(skillNameClean)) {
        projectScore += 8.0
      }

      for (const trigger of skill.triggers) {
        if (projectStack.has(trigger.toLowerCase())) {
          projectScore += 6.0
        }
      }

      for (const tag of skill.tags) {
        if (projectStack.has(tag.toLowerCase())) {
          projectScore += 4.0
        }
      }
    }

    if (fileContextText) {
      for (const trigger of skill.triggers) {
        if (matchesWordOrPhrase(fileContextText, trigger)) {
          projectScore += 3.0
        }
      }
      for (const tag of skill.tags) {
        if (matchesWordOrPhrase(fileContextText, tag)) {
          projectScore += 1.5
        }
      }
    }

    // --- 3. Combined Score & Synergy ---
    let totalScore = promptScore + projectScore

    // Synergy bonus when both prompt and project stack match
    if (promptScore > 0 && projectScore > 0) {
      totalScore += 5.0
    }

    // Baseline active preference
    if (skill.isActive) {
      totalScore += 1.0
    }

    if (totalScore > 0) {
      scoredSkills.push({ skill, score: totalScore })
    }
  }

  // Sort by score descending and limit to top skills for context budgeting
  return scoredSkills
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSkillsToInject)
    .map((s) => s.skill)
}

export function compileSkillsContextBlock(skills: SkillDefinition[], maxTotalChars: number = 8000): string {
  if (skills.length === 0) return ''

  let result = '## CONTEXTUAL SKILLS & DOMAIN GUIDELINES (Active)\n\n'
  let currentChars = result.length
  const perSkillMax = skills.length > 1 ? Math.floor(maxTotalChars / Math.min(skills.length, 3)) : maxTotalChars

  for (const skill of skills) {
    const header = `### SKILL: ${skill.name}\n${skill.description ? `*Description*: ${skill.description}\n` : ''}\`\`\`markdown\n`
    const footer = '\n```\n\n'
    const availableBudget = maxTotalChars - currentChars - header.length - footer.length

    if (availableBudget <= 200) {
      break
    }

    const maxSkillSlice = Math.min(availableBudget, perSkillMax)
    const trimmedContent = skill.content.length > maxSkillSlice
      ? `${skill.content.slice(0, maxSkillSlice)}\n... [Skill content truncated for context budget]`
      : skill.content

    const block = `${header}${trimmedContent}${footer}`
    result += block
    currentChars += block.length
  }

  return result.trim()
}
