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
}

export function matchSkillsForTask(
  userTaskOrContext: string | SkillMatchContext,
  availableSkills: SkillDefinition[],
  maxSkillsToInject: number = 3
): SkillDefinition[] {
  if (!userTaskOrContext || availableSkills.length === 0) return []

  const userTask = typeof userTaskOrContext === 'string' ? userTaskOrContext : userTaskOrContext.userTask || ''
  if (!userTask && typeof userTaskOrContext === 'string') return []

  let expandedLookup = userTask.toLowerCase()

  if (typeof userTaskOrContext !== 'string') {
    const ctx = userTaskOrContext
    if (ctx.activeFilePath) {
      const ext = ctx.activeFilePath.split('.').pop() || ''
      const fileName = ctx.activeFilePath.split(/[\/\\]/).pop() || ''
      expandedLookup += ` ${fileName.toLowerCase()} ext:${ext.toLowerCase()} ${ext.toLowerCase()}`
    }
    if (ctx.pinnedFiles && ctx.pinnedFiles.length > 0) {
      for (const pf of ctx.pinnedFiles) {
        const pExt = pf.path.split('.').pop() || ''
        const pName = pf.name || pf.path.split(/[\/\\]/).pop() || ''
        expandedLookup += ` ${pName.toLowerCase()} ${pExt.toLowerCase()}`
      }
    }
    if (ctx.workspacePath) {
      const wsName = ctx.workspacePath.split(/[\/\\]/).pop() || ''
      expandedLookup += ` workspace:${wsName.toLowerCase()}`
    }
    if (ctx.activeFileContent) {
      // Sample first 300 characters for import and framework signatures
      const snippet = ctx.activeFileContent.slice(0, 300).toLowerCase().replace(/[^a-z0-9-_]/g, ' ')
      expandedLookup += ` ${snippet}`
    }
  }

  const lowerTask = expandedLookup
  const scoredSkills: { skill: SkillDefinition; score: number }[] = []

  for (const skill of availableSkills) {
    let score = 0

    // 1. Explicit active toggle by user (+10.0)
    if (skill.isActive) {
      score += 10.0
    }

    // 2. Exact name match in task (+5.0)
    const skillSlug = skill.name.toLowerCase().replace(/[-_]/g, ' ')
    if (matchesWordOrPhrase(lowerTask, skillSlug) || matchesWordOrPhrase(lowerTask, skill.name)) {
      score += 5.0
    }

    // 3. Triggers matching (+3.0 each)
    for (const trigger of skill.triggers) {
      if (matchesWordOrPhrase(lowerTask, trigger)) {
        score += 3.0
      }
    }

    // 4. Tags matching (+1.5 each)
    for (const tag of skill.tags) {
      if (matchesWordOrPhrase(lowerTask, tag)) {
        score += 1.5
      }
    }

    // 5. Description unique keywords matching (+1.0 each, deduplicated)
    const descWords = Array.from(
      new Set(
        skill.description
          .toLowerCase()
          .split(/[^a-z0-9-_]+/)
          .filter((w) => w.length >= 4 && !STOP_WORDS.has(w))
      )
    )

    for (const word of descWords) {
      if (matchesWordOrPhrase(lowerTask, word)) {
        score += 1.0
      }
    }

    if (score > 0) {
      scoredSkills.push({ skill, score })
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
