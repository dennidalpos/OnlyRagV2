import { describe, expect, it } from 'vitest'
import { shouldAutomaticallyPlanCodingTask } from './automaticPlanningPolicy'

describe('automatic coding planning policy', () => {
  it('keeps Ask read-only without entering an execution plan flow', () => {
    expect(shouldAutomaticallyPlanCodingTask('Refactor the architecture across the whole repository', 'ask')).toBe(false)
  })

  it('plans complex Guided and Auto work', () => {
    expect(shouldAutomaticallyPlanCodingTask('Migrate the database schema and update the workflow end-to-end', 'guided')).toBe(true)
    expect(shouldAutomaticallyPlanCodingTask('1. Add the API\n2. Update the UI', 'auto')).toBe(true)
  })

  it('runs a small focused edit directly', () => {
    expect(shouldAutomaticallyPlanCodingTask('Fix the typo in README.md', 'guided')).toBe(false)
  })
})
