import { describe, expect, it } from 'vitest'
import { parseSidecarHealthResponse } from './sidecarHealth'

const validHealth = {
  status: 'online',
  engine: 'FastAPI + LanceDB',
  version: '2.3.0',
  vector_db: 'LanceDB Embedded',
  gpu: {},
  ocr: {},
  documents_count: 2,
  chunks_count: 5,
  python_version: '3.13',
}

describe('parseSidecarHealthResponse', () => {
  it('accepts the complete sidecar health contract', () => {
    expect(parseSidecarHealthResponse(validHealth)).toEqual(validHealth)
  })

  it('rejects malformed and optimistic partial responses', () => {
    expect(parseSidecarHealthResponse({ status: 'online' })).toBeNull()
    expect(parseSidecarHealthResponse({ ...validHealth, chunks_count: -1 })).toBeNull()
    expect(parseSidecarHealthResponse('online')).toBeNull()
  })
})
