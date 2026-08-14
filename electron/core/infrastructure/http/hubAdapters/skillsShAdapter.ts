import { HubSkillItem, SkillHubSource, SkillCategory } from '../../../domain/skills/skillTypes'
import { ISkillHubAdapter } from './hubAdapterInterface'
import { webClient } from '../webClient'
import { logger } from '../../../../diagnostics'

export const SKILLS_SH_FEATURED_SKILLS: Record<string, {
  name: string
  description: string
  category: SkillCategory
  triggers: string[]
  tags: string[]
  author: string
  subpath: string
}> = {
  'grill-me': {
    name: 'grill-me',
    description: 'A relentless interview that sharpens plans, ideas, and architecture by questioning assumptions before coding.',
    category: 'architecture',
    triggers: ['grill-me', 'grill', 'interview', 'design-review', 'sharpen-plan'],
    tags: ['interview', 'design', 'architecture', 'skills-sh', 'mattpocock'],
    author: 'mattpocock',
    subpath: 'skills/productivity/grill-me/SKILL.md',
  },
  'grill-with-docs': {
    name: 'grill-with-docs',
    description: 'Grills and validates architectural plans and PRs against official documentation and local codebase context.',
    category: 'architecture',
    triggers: ['grill-with-docs', 'verify-docs', 'doc-review', 'spec-check'],
    tags: ['docs', 'architecture', 'review', 'skills-sh', 'mattpocock'],
    author: 'mattpocock',
    subpath: 'skills/engineering/grill-with-docs/SKILL.md',
  },
  'code-review': {
    name: 'code-review',
    description: 'Disciplined multi-dimensional code reviews checking edge cases, type safety, error boundaries, and SRP.',
    category: 'architecture',
    triggers: ['code-review', 'review', 'pr-review', 'audit-code'],
    tags: ['review', 'quality', 'engineering', 'skills-sh', 'mattpocock'],
    author: 'mattpocock',
    subpath: 'skills/engineering/code-review/SKILL.md',
  },
  'diagnosing-bugs': {
    name: 'diagnosing-bugs',
    description: 'Scientific bug diagnosis workflow: reproduce, isolate minimal case, form hypotheses, and verify root cause.',
    category: 'backend',
    triggers: ['diagnosing-bugs', 'debug', 'root-cause', 'isolate-bug', 'fix-bug'],
    tags: ['debugging', 'troubleshooting', 'engineering', 'skills-sh', 'mattpocock'],
    author: 'mattpocock',
    subpath: 'skills/engineering/diagnosing-bugs/SKILL.md',
  },
  'codebase-design': {
    name: 'codebase-design',
    description: 'Senior architectural guidance for modularity, clean boundaries, dependency inversion, and scalable layout.',
    category: 'architecture',
    triggers: ['codebase-design', 'modular-design', 'architecture-pattern', 'dependency-inversion'],
    tags: ['design', 'architecture', 'engineering', 'skills-sh', 'mattpocock'],
    author: 'mattpocock',
    subpath: 'skills/engineering/codebase-design/SKILL.md',
  },
  'domain-modeling': {
    name: 'domain-modeling',
    description: 'Domain-Driven Design modeling: identify aggregates, domain entities, value objects, and business invariants.',
    category: 'architecture',
    triggers: ['domain-modeling', 'ddd', 'domain-entity', 'value-object', 'business-rules'],
    tags: ['ddd', 'domain', 'modeling', 'skills-sh', 'mattpocock'],
    author: 'mattpocock',
    subpath: 'skills/engineering/domain-modeling/SKILL.md',
  },
  'improve-codebase-architecture': {
    name: 'improve-codebase-architecture',
    description: 'Systematic refactoring strategies for decomposing monoliths, reducing coupling, and isolating side-effects.',
    category: 'architecture',
    triggers: ['improve-codebase-architecture', 'refactor-architecture', 'decompose', 'clean-layers'],
    tags: ['refactoring', 'architecture', 'skills-sh', 'mattpocock'],
    author: 'mattpocock',
    subpath: 'skills/engineering/improve-codebase-architecture/SKILL.md',
  },
  'tdd': {
    name: 'tdd',
    description: 'Strict Test-Driven Development (Red-Green-Refactor) loops ensuring comprehensive test coverage.',
    category: 'devops',
    triggers: ['tdd', 'test-driven', 'red-green-refactor', 'unit-tests-first'],
    tags: ['testing', 'tdd', 'engineering', 'skills-sh', 'mattpocock'],
    author: 'mattpocock',
    subpath: 'skills/engineering/tdd/SKILL.md',
  },
  'to-spec': {
    name: 'to-spec',
    description: 'Transforms high-level feature requests and fuzzy user ideas into rigorous technical specifications.',
    category: 'architecture',
    triggers: ['to-spec', 'write-spec', 'technical-spec', 'feature-spec'],
    tags: ['spec', 'planning', 'engineering', 'skills-sh', 'mattpocock'],
    author: 'mattpocock',
    subpath: 'skills/engineering/to-spec/SKILL.md',
  },
  'to-tickets': {
    name: 'to-tickets',
    description: 'Breaks down complex technical specs into discrete, atomic, and parallelizable developer tickets.',
    category: 'architecture',
    triggers: ['to-tickets', 'decompose-tasks', 'create-tickets', 'sprint-breakdown'],
    tags: ['tickets', 'planning', 'management', 'skills-sh', 'mattpocock'],
    author: 'mattpocock',
    subpath: 'skills/engineering/to-tickets/SKILL.md',
  },
  'writing-for-agents': {
    name: 'writing-for-agents',
    description: 'Best practices for authoring prompts, guidelines, and documentation tailored for autonomous AI agents.',
    category: 'ai-ml',
    triggers: ['writing-for-agents', 'agent-prompts', 'llm-guidelines', 'prompt-design'],
    tags: ['agents', 'prompts', 'ai', 'skills-sh', 'mattpocock'],
    author: 'mattpocock',
    subpath: 'skills/productivity/writing-for-agents/SKILL.md',
  },
  'handoff': {
    name: 'handoff',
    description: 'Summarizes work state, outstanding questions, and remaining tasks for smooth agent-to-agent or human handoff.',
    category: 'architecture',
    triggers: ['handoff', 'task-summary', 'context-handoff', 'session-end'],
    tags: ['handoff', 'productivity', 'skills-sh', 'mattpocock'],
    author: 'mattpocock',
    subpath: 'skills/productivity/handoff/SKILL.md',
  },
  'find-skills': {
    name: 'find-skills',
    description: 'Search and discovery engine for discovering specialized skills across the open agent skills ecosystem.',
    category: 'architecture',
    triggers: ['find-skills', 'search-skills', 'discover-skill', 'skills-registry'],
    tags: ['discovery', 'registry', 'skills-sh', 'vercel-labs'],
    author: 'vercel-labs',
    subpath: 'skills/find-skills/SKILL.md',
  },
}

function generateSkillsShContent(item: { name: string; description: string; triggers: string[]; tags: string[]; author: string }): string {
  return `---
name: ${item.name}
description: "${item.description.replace(/"/g, "'")}"
version: "1.0.0"
author: "${item.author}"
triggers: [${item.triggers.map((t) => `"${t}"`).join(', ')}]
tags: [${item.tags.map((t) => `"${t}"`).join(', ')}]
origin_hub: "Skills.sh Open Agent Directory"
---

# ${item.name.toUpperCase()} — Skills.sh Guidelines

## 1. Principle
${item.description}

## 2. Execution Directives
- Applica i criteri di qualità software definiti dalla skill \`${item.name}\` per tutte le operazioni correlate.
- Mantieni un approccio metodico e verifica sempre i risultati prima di proseguire.
`
}

export class SkillsShAdapter implements ISkillHubAdapter {
  canHandle(source: SkillHubSource): boolean {
    return (
      source.id === 'skills-sh' ||
      source.url.includes('skills.sh') ||
      source.url.includes('mattpocock/skills')
    )
  }

  async fetchSkills(source: SkillHubSource): Promise<HubSkillItem[]> {
    logger.log('INFO', 'SkillsShAdapter', 'Fetching skills from Skills.sh open agent registry')

    const items: HubSkillItem[] = []

    for (const [key, item] of Object.entries(SKILLS_SH_FEATURED_SKILLS)) {
      const rawDownloadUrl = `https://raw.githubusercontent.com/${item.author}/skills/main/${item.subpath}`

      items.push({
        id: `skills-sh-${key}`,
        name: item.name,
        description: item.description,
        category: item.category,
        tags: item.tags,
        triggers: item.triggers,
        version: '1.0.0',
        author: item.author,
        downloadUrl: rawDownloadUrl,
        rawContent: generateSkillsShContent(item),
        hubId: source.id,
        hubName: source.name,
      })
    }

    return items
  }
}
