/**
 * Answers a model's question about dependency versions from registry facts. In AUTO mode such a
 * question used to end the run although the application could answer it (full task run 24,
 * 2026-09-24): versions are facts the npm registry holds, not a user decision.
 */

import { maxSatisfying, validRange } from 'semver'
import { CONFIG_BREAKING_ON_MAJOR, type DeclaredDependency, majorOf, type RegistryFact } from './dependencyVersionReality'

const VERSION_QUESTION = /\b(?:versions?|versione|versioni|semver)\b/i

/** Upper bound of packages looked up for one question. */
export const MAX_VERSION_QUESTION_PACKAGES = 12

export function isVersionQuestion(question: string): boolean {
  return VERSION_QUESTION.test(question)
}

const PACKAGE_TOKEN = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i

function mentions(question: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|[^\\w@/.-])${escaped}(?:$|[^\\w/-])`, 'i').test(question)
}

/**
 * The packages the question is about: declared ones it names, names written as `name@range`, and,
 * when it names none, every declared dependency.
 */
export function versionQuestionPackages(question: string, declaredNames: readonly string[]): string[] {
  const named = new Set(declaredNames.filter((name) => mentions(question, name)))
  for (const match of question.matchAll(/((?:@[\w.-]+\/)?[\w.-]+)@[\^~]?\d/g)) {
    if (PACKAGE_TOKEN.test(match[1]) && !/^\d/.test(match[1])) named.add(match[1])
  }
  const packages = named.size > 0 ? [...named] : [...declaredNames]
  return packages.slice(0, MAX_VERSION_QUESTION_PACKAGES)
}

function answerLine(fact: RegistryFact, declared: DeclaredDependency | undefined): string {
  if (!fact.exists) return `- ${fact.name}: does not exist on npm. Do not declare it; use a published package instead.`
  if (!fact.latest)
    return `- ${fact.name}: the registry could not be reached; keep ${declared ? `the declared ${declared.range}` : 'the current published version'}.`
  if (!declared) return `- ${fact.name}: declare "^${fact.latest}" (latest published).`
  const published = !fact.versions || !validRange(declared.range) || maxSatisfying([...fact.versions], declared.range, { includePrerelease: true })
  if (!published) return `- ${fact.name}: the declared ${declared.range} matches no published release; declare "^${fact.latest}".`
  const declaredMajor = majorOf(declared.range)
  const latestMajor = majorOf(fact.latest)
  if (declaredMajor !== null && latestMajor !== null && latestMajor > declaredMajor && !CONFIG_BREAKING_ON_MAJOR.has(fact.name)) {
    return `- ${fact.name}: declared ${declared.range} is a major behind; declare "^${fact.latest}".`
  }
  return `- ${fact.name}: keep the declared ${declared.range} (latest published ${fact.latest}).`
}

/** The directive that replaces the user's answer. */
export function buildVersionAnswer(facts: readonly RegistryFact[], declared: readonly DeclaredDependency[]): string {
  const byName = new Map(declared.map((dependency) => [dependency.name, dependency]))
  const lines = facts.map((fact) => answerLine(fact, byName.get(fact.name)))
  return [
    '[AUTONOMOUS VERSION ANSWER: DO NOT ASK ABOUT VERSIONS]',
    'In AUTO mode the application answers version questions itself, from the npm registry.',
    ...(lines.length > 0
      ? ['Registry facts:', ...lines]
      : ['Declare the current published version of each package ("^<latest>"); every package.json write is checked against the registry.']),
    'Continue with the current milestone using these versions. Do not call ask about versions again.',
  ].join('\n')
}
