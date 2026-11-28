import { describe, expect, it } from 'vitest'
import { buildActiveInterventionActions } from '../../../../shared/domain/agent/activeInterventionActions'

describe('buildActiveInterventionActions', () => {
  it('builds a bounded file-edit sequence with one verification after the group', () => {
    const actions = buildActiveInterventionActions({
      id: 'm-1',
      title: 'Update authentication',
      status: 'in_progress',
      filePaths: ['src/auth.ts'],
      verificationCommand: 'npm test',
    })

    expect(actions).toHaveLength(4)
    expect(actions[0]).toContain('src/auth.ts')
    expect(actions[1]).toContain('one scoped edit')
    expect(actions[2]).toContain('linked files coherent')
    expect(actions[3]).toContain('npm test')
  })
})
