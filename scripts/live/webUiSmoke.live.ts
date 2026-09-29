import { describe, expect, it } from 'vitest'
import { verifyWebUi } from '../../electron/core/infrastructure/process/webUiSmokeVerifier'

const workspace = process.env.ONLYRAG_LIVE_WORKSPACE

describe.skipIf(!workspace)('web UI smoke against an existing live workspace', () => {
  it('reports browser errors and missing requested CSS after a green build', async () => {
    const result = await verifyWebUi(workspace!, [
      {
        id: 'm-ui',
        title: 'Responsive Tailwind CSS layout',
        status: 'in_progress',
        acceptanceCriteria: ['Dashboard and Tasks navigation', 'Touch targets at least 44x44'],
      },
    ])
    expect(result.status).toBe('failed')
    expect(result.detail).toContain('Button is not defined')
    expect(result.detail).toContain('no CSS file')
  })
})
