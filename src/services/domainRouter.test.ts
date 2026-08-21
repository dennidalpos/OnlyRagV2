import { describe, it, expect } from 'vitest'
import {
  evaluateDomainIntent,
  calculateCentroidSimilarity,
  MEDICAL_CENTROID,
  LEGAL_CENTROID,
  MEDICAL_CENTROID_ROOTS,
  LEGAL_CENTROID_ROOTS,
} from './domainRouter'
import type { AppSettings } from '../types'

describe('Domain & Intent Sub-Router Unit Tests', () => {
  const mockSettings: AppSettings = {
    defaultModel: 'llama3.2',
    chatModel: 'llama3.1:8b',
    medicalModel: 'adrienbrault/biomistral-7b:Q4_K_M',
    legalModel: 'saul-instruct:7b',
    hardwareProfile: 'Auto',
    ocrEngine: 'native_cuda',
    ollamaHost: 'http://127.0.0.1:11434',
  }

  describe('Italian Queries', () => {
    it('should route Italian medical query to medicalModel', () => {
      const res = evaluateDomainIntent('Quali sono i sintomi della polmonite e la posologia del farmaco?', mockSettings)
      expect(res.domain).toBe('medical')
      expect(res.modelName).toBe('adrienbrault/biomistral-7b:Q4_K_M')
      expect(res.requiresRetrieval).toBe(true)
    })

    it('should route Italian legal query to legalModel', () => {
      const res = evaluateDomainIntent('Quali clausole di risarcimento del danno sono previste secondo art. 1341 c.c.?', mockSettings)
      expect(res.domain).toBe('legal')
      expect(res.modelName).toBe('saul-instruct:7b')
      expect(res.requiresRetrieval).toBe(true)
    })
  })

  describe('English Queries', () => {
    it('should route English medical query to medicalModel', () => {
      const res = evaluateDomainIntent('What is the recommended antibiotic dosage for acute bacterial pneumonia?', mockSettings)
      expect(res.domain).toBe('medical')
      expect(res.modelName).toBe('adrienbrault/biomistral-7b:Q4_K_M')
      expect(res.requiresRetrieval).toBe(true)
    })

    it('should route English legal query to legalModel', () => {
      const res = evaluateDomainIntent('What are the remedies for breach of contract and indemnification under jurisdiction?', mockSettings)
      expect(res.domain).toBe('legal')
      expect(res.modelName).toBe('saul-instruct:7b')
      expect(res.requiresRetrieval).toBe(true)
    })
  })

  describe('Spanish Queries', () => {
    it('should route Spanish medical query to medicalModel', () => {
      const res = evaluateDomainIntent('Cuáles son los síntomas clínicos y la prescripción del tratamiento?', mockSettings)
      expect(res.domain).toBe('medical')
      expect(res.modelName).toBe('adrienbrault/biomistral-7b:Q4_K_M')
    })

    it('should route Spanish legal query to legalModel', () => {
      const res = evaluateDomainIntent('Cuáles son las cláusulas de indemnización según la sentencia del tribunal?', mockSettings)
      expect(res.domain).toBe('legal')
      expect(res.modelName).toBe('saul-instruct:7b')
    })
  })

  describe('French Queries', () => {
    it('should route French medical query to medicalModel', () => {
      const res = evaluateDomainIntent('Quelle est la posologie du médicament prescrit pour cette pathologie?', mockSettings)
      expect(res.domain).toBe('medical')
      expect(res.modelName).toBe('adrienbrault/biomistral-7b:Q4_K_M')
    })

    it('should route French legal query to legalModel', () => {
      const res = evaluateDomainIntent('Quelles sont les clauses de résiliation du contrat en cas de litige?', mockSettings)
      expect(res.domain).toBe('legal')
      expect(res.modelName).toBe('saul-instruct:7b')
    })
  })

  describe('German Queries', () => {
    it('should route German medical query to medicalModel', () => {
      const res = evaluateDomainIntent('Was ist die empfohlene Medikamentendosierung für den Patienten?', mockSettings)
      expect(res.domain).toBe('medical')
      expect(res.modelName).toBe('adrienbrault/biomistral-7b:Q4_K_M')
    })

    it('should route German legal query to legalModel', () => {
      const res = evaluateDomainIntent('Welche Schadensersatzklauseln gelten bei Vertragsbruch laut Gesetzbuch?', mockSettings)
      expect(res.domain).toBe('legal')
      expect(res.modelName).toBe('saul-instruct:7b')
    })
  })

  describe('General & Chit-Chat Queries', () => {
    it('should route general document questions to chatModel', () => {
      const res = evaluateDomainIntent('Qual è il riassunto del documento allegato?', mockSettings)
      expect(res.domain).toBe('general')
      expect(res.modelName).toBe('llama3.1:8b')
      expect(res.requiresRetrieval).toBe(true)
    })

    it('should detect chit-chat greetings across languages and set requiresRetrieval=false', () => {
      const itChat = evaluateDomainIntent('Ciao come stai?', mockSettings)
      expect(itChat.domain).toBe('general')
      expect(itChat.requiresRetrieval).toBe(false)

      const enChat = evaluateDomainIntent('Hello how are you today', mockSettings)
      expect(enChat.domain).toBe('general')
      expect(enChat.requiresRetrieval).toBe(false)

      const frChat = evaluateDomainIntent('Bonjour merci', mockSettings)
      expect(frChat.domain).toBe('general')
      expect(frChat.requiresRetrieval).toBe(false)

      const deChat = evaluateDomainIntent('Guten Tag danke', mockSettings)
      expect(deChat.domain).toBe('general')
      expect(deChat.requiresRetrieval).toBe(false)
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
  })

  describe('Vector Centroid Similarity Engine', () => {
    it('should calculate zero-latency centroid similarity for medical and legal queries', () => {
      const medQuery = 'polmonite amoxicillina cefalea faringite epatologia nefropatia'
      const medSim = calculateCentroidSimilarity(medQuery, MEDICAL_CENTROID)
      expect(medSim).toBeGreaterThan(0.2)

      const legalQuery = 'giurisdizione inadempimento risarcitorio decretato societario bancarotta'
      const legalSim = calculateCentroidSimilarity(legalQuery, LEGAL_CENTROID)
      expect(legalSim).toBeGreaterThan(0.2)

      const genericQuery = 'cane gatto tavolo sedia automobile'
      expect(calculateCentroidSimilarity(genericQuery, MEDICAL_CENTROID)).toBe(0)
      expect(calculateCentroidSimilarity(genericQuery, LEGAL_CENTROID)).toBe(0)
    })

    it('should support legacy root array format', () => {
      const medSim = calculateCentroidSimilarity('antibiotico posologia', MEDICAL_CENTROID_ROOTS)
      expect(medSim).toBeGreaterThan(0)

      const legalSim = calculateCentroidSimilarity('clausola risarcimento', LEGAL_CENTROID_ROOTS)
      expect(legalSim).toBeGreaterThan(0)
    })
  })
})
