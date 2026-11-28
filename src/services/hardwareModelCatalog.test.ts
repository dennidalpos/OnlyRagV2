import { describe, it, expect } from 'vitest'
import { buildHardwareWizardModelSuite } from '../../shared/domain/hardware/hardwareModelCatalog'

describe('starter model suite', () => {
  it('assigns a small complete suite without depending on hardware tier', () => {
    expect(buildHardwareWizardModelSuite()).toEqual({
      coding: 'qwen2.5-coder:3b',
      chat: 'llama3.2:3b',
      translation: 'llama3.2:3b',
      vision: 'moondream:latest',
      embedding: 'nomic-embed-text:latest',
    })
  })
})
