import { describe, it, expect } from 'vitest'
import {
  estimateModelWeightGB,
  estimateWeightFromMetadata,
  KNOWN_WEIGHT_ALIASES_GB,
  QUANT_BYTES_PER_PARAM,
} from './modelWeightEstimator'
import type { RunningModelDetails } from '../../types'

describe('modelWeightEstimator Unit Tests', () => {
  describe('estimateWeightFromMetadata', () => {
    it('returns null when parameter_size is missing or empty', () => {
      expect(estimateWeightFromMetadata({} as RunningModelDetails)).toBeNull()
      expect(estimateWeightFromMetadata({ parameter_size: '' } as RunningModelDetails)).toBeNull()
      expect(estimateWeightFromMetadata({ parameter_size: 'unknown' } as RunningModelDetails)).toBeNull()
    })

    it('calculates weight correctly for billion parameters with default q4 quantization', () => {
      const details: RunningModelDetails = {
        parameter_size: '7.6B',
        quantization_level: 'Q4_K_M',
      }
      const weight = estimateWeightFromMetadata(details)
      expect(weight).not.toBeNull()
      // (7.6 * 10^9 * 0.60) / 1024^3 = 4560000000 / 1073741824 = ~4.25 GB
      expect(weight).toBeCloseTo(4.25, 1)
    })

    it('calculates weight correctly for fp16 and fp32 quantization', () => {
      const detailsFp16: RunningModelDetails = {
        parameter_size: '7B',
        quantization_level: 'F16',
      }
      // (7.0 * 10^9 * 2) / 1024^3 = 14000000000 / 1073741824 = ~13.04 GB
      expect(estimateWeightFromMetadata(detailsFp16)).toBeCloseTo(13.04, 1)

      const detailsFp32: RunningModelDetails = {
        parameter_size: '1.5B',
        quantization_level: 'F32',
      }
      // (1.5 * 10^9 * 4) / 1024^3 = ~5.59 GB
      expect(estimateWeightFromMetadata(detailsFp32)).toBeCloseTo(5.59, 1)
    })

    it('handles million parameters (M) and thousand parameters (K)', () => {
      const detailsM: RunningModelDetails = {
        parameter_size: '350M',
        quantization_level: 'Q4_K_M',
      }
      // (0.35 * 10^9 * 0.60) / 1024^3 = ~0.20 GB
      expect(estimateWeightFromMetadata(detailsM)).toBeCloseTo(0.20, 2)

      const detailsK: RunningModelDetails = {
        parameter_size: '500K',
        quantization_level: 'Q4_K_M',
      }
      // (0.0005 * 10^9 * 0.60) / 1024^3 = ~0.00028 GB -> rounds to 0.00 GB
      expect(estimateWeightFromMetadata(detailsK)).toBe(0)
    })

    it('supports all known quantization level keys in QUANT_BYTES_PER_PARAM', () => {
      for (const quantKey of Object.keys(QUANT_BYTES_PER_PARAM)) {
        const details: RunningModelDetails = {
          parameter_size: '7B',
          quantization_level: quantKey.toUpperCase(),
        }
        const weight = estimateWeightFromMetadata(details)
        expect(weight).toBeGreaterThan(0)
      }
    })
  })

  describe('estimateModelWeightGB', () => {
    it('returns default fallback 4.5 GB for empty or sentinel model names', () => {
      expect(estimateModelWeightGB('')).toBe(4.5)
      expect(estimateModelWeightGB('   ')).toBe(4.5)
      expect(estimateModelWeightGB('local')).toBe(4.5)
      expect(estimateModelWeightGB('none')).toBe(4.5)
      expect(estimateModelWeightGB('LOCAL')).toBe(4.5)
    })

    it('prefers Ollama-reported metadata over static lookup table when valid', () => {
      const details: RunningModelDetails = {
        parameter_size: '7.6B',
        quantization_level: 'Q4_K_M',
      }
      const weight = estimateModelWeightGB('qwen2.5-coder:7b-instruct-q8_0', details)
      // Real metadata gives ~4.25 instead of the static alias table value 7.6
      expect(weight).toBeCloseTo(4.25, 1)
    })

    it('resolves exact match from KNOWN_WEIGHT_ALIASES_GB', () => {
      for (const [tag, expectedWeight] of Object.entries(KNOWN_WEIGHT_ALIASES_GB)) {
        expect(estimateModelWeightGB(tag)).toBe(expectedWeight)
        expect(estimateModelWeightGB(tag.toUpperCase())).toBe(expectedWeight)
      }
    })

    it('resolves prefix match when model tag extends a known base', () => {
      // 'bge-m3' is known with 1.1 GB; 'bge-m3:latest' extends it
      expect(estimateModelWeightGB('bge-m3:custom-tag')).toBe(1.1)
    })

    it('heuristically derives weight from parameter size in billions (B)', () => {
      expect(estimateModelWeightGB('custom-model:0.5b')).toBe(0.5)
      expect(estimateModelWeightGB('custom-model:1.5b')).toBe(1.6)
      expect(estimateModelWeightGB('my-coder:3b')).toBe(2.0)
      expect(estimateModelWeightGB('deepseek-new:7b')).toBe(4.4)
      expect(estimateModelWeightGB('llama-test:8b')).toBe(4.9)
      expect(estimateModelWeightGB('qwen-custom:14b')).toBe(9.0)
      expect(estimateModelWeightGB('mistral-custom:22b')).toBe(13.0)
      expect(estimateModelWeightGB('giant-coder:32b')).toBe(20.0)
      expect(estimateModelWeightGB('massive-model:70b')).toBe(40.0)
      expect(estimateModelWeightGB('titan-model:120b')).toBe(72.0) // 120 * 0.6
    })

    it('heuristically derives weight from parameter size in millions (M)', () => {
      expect(estimateModelWeightGB('smollm:135m')).toBe(0.135)
      expect(estimateModelWeightGB('custom-embed:350m')).toBe(0.35)
    })

    it('falls back to 4.5 GB for completely unknown models without parameter hints', () => {
      expect(estimateModelWeightGB('totally-unknown-model-without-size')).toBe(4.5)
    })
  })
})
