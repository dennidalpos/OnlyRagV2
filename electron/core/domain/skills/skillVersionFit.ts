/**
 * Skills written for one major version of a package (named `<package>-v<major>`, e.g.
 * `tailwind-css-v4`) contradict a workspace that declares another major. Matched on the task text
 * alone, tailwind-css-v4 ordered `@import "tailwindcss"` into projects declaring tailwindcss ^3, and
 * its "DO NOT write @tailwind" line made the adherence check refuse the v3 directives (live full
 * task runs 21 and gpt-oss run 4 of 2026-09-24): the build could not pass either way.
 */

export interface SkillVersionConflict {
  skillName: string
  packageName: string
  skillMajor: number
  declaredRange: string
}

const VERSIONED_SKILL_NAME = /^(.+?)[-_ ]?v(\d+)$/i

function compactName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^@[^/]+\//, '')
    .replace(/[^a-z0-9]/g, '')
}

/** The major a manifest range pins (`^3.4.1`, `~3`, `3.x`, `>=3 <4`), or null when it pins none. */
export function declaredMajorVersion(range: string): number | null {
  const clean = range.trim()
  if (!clean || /^(?:\*|x|latest|next)$/i.test(clean) || /[:/]/.test(clean)) return null
  // A union (`^3 || ^4`) or an open lower bound (`>=3`) allows more than one major.
  if (clean.includes('||') || (/^>/.test(clean) && !/</.test(clean))) return null
  const major = /(\d+)/.exec(clean)
  return major ? Number(major[1]) : null
}

/** The conflict between a `<package>-v<major>` skill and the major the workspace declares, if any. */
export function skillVersionConflict(skillName: string, declaredDependencies: Readonly<Record<string, string>>): SkillVersionConflict | null {
  const named = VERSIONED_SKILL_NAME.exec(skillName.trim())
  if (!named) return null
  const stem = compactName(named[1])
  const skillMajor = Number(named[2])
  for (const [packageName, declaredRange] of Object.entries(declaredDependencies)) {
    if (compactName(packageName) !== stem) continue
    const declared = declaredMajorVersion(String(declaredRange))
    if (declared !== null && declared !== skillMajor) return { skillName, packageName, skillMajor, declaredRange: String(declaredRange) }
  }
  return null
}

/** The skills that do not contradict a declared package major; all of them when nothing is declared. */
export function skillsFittingDeclaredVersions<T extends { name: string }>(
  skills: readonly T[],
  declaredDependencies: Readonly<Record<string, string>> | undefined,
): T[] {
  if (!declaredDependencies || Object.keys(declaredDependencies).length === 0) return [...skills]
  return skills.filter((skill) => !skillVersionConflict(skill.name, declaredDependencies))
}
