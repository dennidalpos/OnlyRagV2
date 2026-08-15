import { describe, it, expect } from 'vitest'
import { matchSkillsForTask, matchHubSkillsForTask, compileSkillsContextBlock } from './skillMatcher'
import { SkillDefinition, HubSkillItem } from './skillTypes'

describe('SkillMatcher Domain Tests', () => {
  const mockSkills: SkillDefinition[] = [
    {
      id: 'react19',
      name: 'react19-guidelines',
      description: 'Best practices for React 19, Server Actions, useActionState, and hooks.',
      content: '# React 19 Guidelines\nAlways use useActionState for form handling.',
      filePath: 'skills/react19/SKILL.md',
      isActive: false,
      isWorkspaceLocal: true,
      triggers: ['react', 'react 19', 'useactionstate', 'hook'],
      tags: ['react', 'frontend', 'hooks'],
      originType: 'local_custom',
    },
    {
      id: 'fastapi',
      name: 'fastapi-python',
      description: 'FastAPI standards, async endpoints, Pydantic v2 schemas.',
      content: '# FastAPI Guidelines\nUse dependency injection for db sessions.',
      filePath: 'skills/fastapi/SKILL.md',
      isActive: false,
      isWorkspaceLocal: true,
      triggers: ['fastapi', 'python', 'pydantic'],
      tags: ['python', 'backend', 'api'],
      originType: 'local_custom',
    },
    {
      id: 'security',
      name: 'security-guardrails',
      description: 'AppSec sandboxing, path traversal prevention, secret masking.',
      content: '# Security Guardrails\nNever leak tokens or secrets.',
      filePath: 'skills/security/SKILL.md',
      isActive: true, // explicitly active
      isWorkspaceLocal: true,
      triggers: ['security', 'appsec'],
      tags: ['security'],
      originType: 'local_custom',
    },
  ]

  it('should match relevant skills based on user prompt triggers', () => {
    const matched = matchSkillsForTask('Optimize the React 19 form using useActionState', mockSkills)
    expect(matched.length).toBeGreaterThan(0)
    expect(matched.some((s) => s.id === 'react19')).toBe(true)
    // explicitly active skill is also matched
    expect(matched.some((s) => s.id === 'security')).toBe(true)
    // unrelated skill is not top scored or excluded
    expect(matched.some((s) => s.id === 'fastapi')).toBe(false)
  })

  it('should compile formatted markdown context block bounded by char limit', () => {
    const block = compileSkillsContextBlock(mockSkills.slice(0, 2), 500)
    expect(block).toContain('## CONTEXTUAL SKILLS & DOMAIN GUIDELINES')
    expect(block).toContain('react19-guidelines')
    expect(block.length).toBeLessThanOrEqual(700)
  })

  it('should not match short triggers as substrings inside unrelated words', () => {
    const skillsWithShortTriggers: SkillDefinition[] = [
      {
        id: 'ts-strict',
        name: 'typescript-strict',
        description: 'TypeScript clean typing rules.',
        content: '# TypeScript rules',
        filePath: 'skills/ts/SKILL.md',
        isActive: false,
        isWorkspaceLocal: true,
        triggers: ['ts'],
        tags: ['ts'],
        originType: 'local_custom',
      },
    ]

    // "run unit tests" has "ts" inside "tests", but should NOT match isolated "ts" trigger
    const matched = matchSkillsForTask('run unit tests and check results', skillsWithShortTriggers)
    expect(matched.length).toBe(0)

    // "compile ts files" has isolated "ts" word, should match
    const matchedValid = matchSkillsForTask('compile ts files for release', skillsWithShortTriggers)
    expect(matchedValid.length).toBe(1)
  })

  it('should match skills based on attached code file extensions and workspace metadata in SkillMatchContext', () => {
    // User task prompt is generic, but active file is a Python FastAPI file
    const matched = matchSkillsForTask(
      {
        userTask: 'Refactor this router endpoint to use dependency injection',
        activeFilePath: 'src/routers/auth.py',
        activeFileContent: 'from fastapi import APIRouter, Depends\nfrom pydantic import BaseModel',
        workspacePath: 'D:/Projects/fastapi-backend',
      },
      mockSkills
    )

    expect(matched.some((s) => s.id === 'fastapi')).toBe(true)
  })

  it('should match skills based on projectStack in context even with generic prompt', () => {
    const matched = matchSkillsForTask(
      {
        userTask: 'Fix button responsive layout',
        projectStack: ['react', 'tailwindcss', 'vite'],
      },
      mockSkills
    )

    expect(matched.some((s) => s.id === 'react19')).toBe(true)
    expect(matched.some((s) => s.id === 'fastapi')).toBe(false)
  })

  it('should prioritize skills matching both projectStack and prompt triggers (synergy bonus)', () => {
    const matched = matchSkillsForTask(
      {
        userTask: 'Refactor useActionState and hooks in form',
        projectStack: ['react', 'typescript'],
      },
      mockSkills,
      1
    )

    expect(matched.length).toBe(1)
    expect(matched[0].id).toBe('react19')
  })

  it('should auto-discover high confidence uninstalled hub skills when score exceeds threshold', () => {
    const hubSkills: HubSkillItem[] = [
      {
        id: 'bigquery-sql',
        name: 'bigquery-sql',
        description: 'BigQuery SQL optimization and query best practices.',
        category: 'database',
        tags: ['bigquery', 'sql', 'database'],
        triggers: ['bigquery', 'bq'],
        version: '1.0.0',
        author: 'Official',
        isInstalled: false,
      },
      {
        id: 'unrelated-hub-skill',
        name: 'docker-container',
        description: 'Docker build guidelines.',
        category: 'devops',
        tags: ['docker'],
        triggers: ['docker'],
        version: '1.0.0',
        author: 'Official',
        isInstalled: false,
      },
    ]

    const matches = matchHubSkillsForTask(
      {
        userTask: 'Optimize BigQuery SQL queries for data analytics',
        projectStack: ['python', 'bigquery'],
      },
      hubSkills,
      8.0
    )

    expect(matches.length).toBe(1)
    expect(matches[0].item.id).toBe('bigquery-sql')
    expect(matches[0].score).toBeGreaterThanOrEqual(8.0)
  })
})
