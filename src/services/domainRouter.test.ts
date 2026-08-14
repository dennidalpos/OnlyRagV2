import { describe, it, expect } from 'vitest'
import {
  evaluateDomainIntent,
  calculateCentroidSimilarity,
  MEDICAL_CENTROID_ROOTS,
  LEGAL_CENTROID_ROOTS,
} from './domainRouter'
import type { AppSettings } from '../types'

describe('Domain & Intent Sub-Router Unit Tests', () => {
  const mockSettings: AppSettings = {
    defaultModel: 'llama3.2',
    chatModel: 'llama3.1:8b',
    medicalModel: 'biomistral:latest',
    legalModel: 'saul-instruct:7b',
    hardwareProfile: 'Auto',
    ocrEngine: 'native_cuda',
    ollamaHost: 'http://127.0.0.1:11434',
  }

  it('should route medical queries to medicalModel', () => {
    const res = evaluateDomainIntent('Quali sono i sintomi della polmonite e la posologia del farmaco?', mockSettings)
    expect(res.domain).toBe('medical')
    expect(res.modelName).toBe('biomistral:latest')
    expect(res.requiresRetrieval).toBe(true)
  })

  it('should route legal queries to legalModel', () => {
    const res = evaluateDomainIntent('Quali clausole di risarcimento del danno sono previste secondo art. 1341 c.c.?', mockSettings)
    expect(res.domain).toBe('legal')
    expect(res.modelName).toBe('saul-instruct:7b')
    expect(res.requiresRetrieval).toBe(true)
  })

  it('should route general queries to chatModel', () => {
    const res = evaluateDomainIntent('Qual è il riassunto del documento allegato?', mockSettings)
    expect(res.domain).toBe('general')
    expect(res.modelName).toBe('llama3.1:8b')
    expect(res.requiresRetrieval).toBe(true)
  })

  it('should detect chit-chat greetings and mark requiresRetrieval as false', () => {
    const res = evaluateDomainIntent('Ciao come stai?', mockSettings)
    expect(res.domain).toBe('general')
    expect(res.requiresRetrieval).toBe(false)
  })

  it('should fallback gracefully to defaultModel when specialist models are undefined', () => {
    const minimalSettings: AppSettings = {
      defaultModel: 'llama3.2',
      hardwareProfile: 'Auto',
      ocrEngine: 'native_cuda',
      ollamaHost: '',
    }
    const resMedical = evaluateDomainIntent('Paziente con referto di ematologia alterato', minimalSettings)
    expect(resMedical.domain).toBe('medical')
    expect(resMedical.modelName).toBe('llama3.2')
  })

  it('should calculate zero-latency centroid similarity for medical and legal token sets', () => {
    const medTokens = ['polmonite', 'amoxicillina', 'cefalea', 'faringite', 'epatologia', 'nefropatia']
    const medSim = calculateCentroidSimilarity(medTokens, MEDICAL_CENTROID_ROOTS)
    expect(medSim).toBeGreaterThan(0.3)

    const legalTokens = ['giurisdizione', 'inadempimento', 'risarcitorio', 'decretato', 'societario', 'bancarotta']
    const legalSim = calculateCentroidSimilarity(legalTokens, LEGAL_CENTROID_ROOTS)
    expect(legalSim).toBeGreaterThan(0.3)

    const genericTokens = ['cane', 'gatto', 'tavolo', 'sedia']
    expect(calculateCentroidSimilarity(genericTokens, MEDICAL_CENTROID_ROOTS)).toBe(0)
    expect(calculateCentroidSimilarity(genericTokens, LEGAL_CENTROID_ROOTS)).toBe(0)
  })
})
