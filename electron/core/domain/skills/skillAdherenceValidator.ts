/** A generated fragment that contradicts an explicit prohibition in an active skill. */
export interface SkillAdherenceViolation {
  skillName: string
  forbiddenFragment: string
}

const DOCUMENTATION_FILE = /(?:\.(?:md|mdx|txt|rst|adoc)$|(?:^|[\\/])(?:readme|changelog|license)(?:\.[^\\/]*)?$)/i
const PROHIBITION = /\b(?:do not|must not|never)\b/i
const ALTERNATIVE_PIVOT = /\b(?:instead|rather than|prefer)\b/i
const CODE_SPAN = /`([^`\r\n]+)`/g

function forbiddenFragments(line: string): string[] {
  const prohibition = PROHIBITION.exec(line)
  if (!prohibition) return []
  const prohibitedClause = line.slice(prohibition.index)
  const alternative = ALTERNATIVE_PIVOT.exec(prohibitedClause)
  const boundedClause = alternative ? prohibitedClause.slice(0, alternative.index) : prohibitedClause
  const fragments: string[] = []
  for (const match of boundedClause.matchAll(CODE_SPAN)) {
    // A single span often holds a sequence such as three legacy CSS directives. Each directive
    // must be independently detectable when the generated file puts them on separate lines.
    for (const part of match[1].match(/[^;]+;?/g) || []) {
      const trimmed = part.trim()
      if (trimmed.length >= 3) fragments.push(trimmed)
    }
  }
  return fragments
}

/**
 * Checks generated source against literal, explicit prohibitions in the active skill block.
 *
 * This intentionally does not infer rules from prose. Only backticked fragments following
 * DO NOT / MUST NOT / NEVER are enforceable; recommendations and inactive skills remain prompt
 * guidance. Documentation files may quote legacy examples and are outside generated-code scope.
 */
export function validateSkillAdherence(
  filePath: string,
  generatedContent: string,
  activeSkillGuidelines: string
): SkillAdherenceViolation | null {
  if (!activeSkillGuidelines || !generatedContent || DOCUMENTATION_FILE.test(filePath || '')) return null

  let skillName = 'active-skill'
  const normalizedContent = generatedContent.replace(/\s+/g, ' ')
  for (const line of activeSkillGuidelines.split(/\r?\n/)) {
    const heading = /^### SKILL:\s*(.+?)\s*$/.exec(line)
    if (heading) {
      skillName = heading[1]
      continue
    }
    for (const fragment of forbiddenFragments(line)) {
      if (generatedContent.includes(fragment) || normalizedContent.includes(fragment.replace(/\s+/g, ' '))) {
        return { skillName, forbiddenFragment: fragment }
      }
    }
  }
  return null
}

export function buildSkillAdherenceRefusal(filePath: string, violation: SkillAdherenceViolation): string {
  return [
    `[ACTIVE SKILL CONSTRAINT — MUTATION NOT APPLIED]`,
    `The active skill "${violation.skillName}" explicitly forbids \`${violation.forbiddenFragment}\`, which this mutation would introduce in "${filePath}".`,
    `The file was not changed. Rebuild the proposed content using the current pattern required by that skill.`,
  ].join('\n')
}
