import { describe, it, expect } from 'vitest'
import {
  classifyHardwareProfileTier,
  resolveEffectiveTier,
  isMinimalHardwareHost,
  calculateRealUsableVram,
  calculateUsableSystemRamGB,
  resolveMaxContextTokens,
} from './hardwareProfileTiers'

describe('hardwareProfileTiers', () => {
  describe('classifyHardwareProfileTier', () => {
    it('should classify GPU-less or low VRAM hosts as legacy', () => {
      expect(classifyHardwareProfileTier({ hasGpu: false, vramTotalMB: 0 })).toBe('legacy')
      expect(classifyHardwareProfileTier({ hasGpu: true, vramTotalMB: 2048 })).toBe('legacy')
      expect(classifyHardwareProfileTier({ hasGpu: true, vramTotalMB: 3500 })).toBe('legacy')
    })

    it('should classify 4-7GB VRAM as entry', () => {
      expect(classifyHardwareProfileTier({ hasGpu: true, vramTotalMB: 4096 })).toBe('entry')
      expect(classifyHardwareProfileTier({ hasGpu: true, vramTotalMB: 6144 })).toBe('entry')
    })

    it('should classify 8-11GB VRAM as midrange', () => {
      expect(classifyHardwareProfileTier({ hasGpu: true, vramTotalMB: 8192 })).toBe('midrange')
      expect(classifyHardwareProfileTier({ hasGpu: true, vramTotalMB: 11000 })).toBe('midrange')
    })

    it('should classify 12-19GB VRAM as highend', () => {
      expect(classifyHardwareProfileTier({ hasGpu: true, vramTotalMB: 12288 })).toBe('highend')
      expect(classifyHardwareProfileTier({ hasGpu: true, vramTotalMB: 16384 })).toBe('highend')
    })

    it('should classify >=20GB VRAM as extreme', () => {
      expect(classifyHardwareProfileTier({ hasGpu: true, vramTotalMB: 24576 })).toBe('extreme')
      expect(classifyHardwareProfileTier({ hasGpu: true, vramTotalMB: 49152 })).toBe('extreme')
    })
  })

  describe('resolveEffectiveTier', () => {
    it('should honour explicit user overrides', () => {
      expect(resolveEffectiveTier('Low', { hasGpu: true, vramTotalMB: 24576 })).toBe('legacy')
      expect(resolveEffectiveTier('Medium', { hasGpu: false, vramTotalMB: 0 })).toBe('midrange')
      expect(resolveEffectiveTier('High', { hasGpu: false, vramTotalMB: 0 })).toBe('highend')
    })

    it('should defer to hardware facts when Auto', () => {
      expect(resolveEffectiveTier('Auto', { hasGpu: true, vramTotalMB: 8192 })).toBe('midrange')
    })
  })

  describe('isMinimalHardwareHost', () => {
    it('should identify minimal hosts with <=8GB RAM or <=4 cores', () => {
      expect(isMinimalHardwareHost({ hasGpu: false, systemRamGB: 8, cpuCount: 4 })).toBe(true)
      expect(isMinimalHardwareHost({ hasGpu: false, systemRamGB: 16, cpuCount: 8 })).toBe(false)
      expect(isMinimalHardwareHost({ hasGpu: true, vramTotalMB: 8192, systemRamGB: 8, cpuCount: 4 })).toBe(false)
    })
  })

  describe('calculateRealUsableVram', () => {
    it('should apply safety margin (25%) and OS overhead (1.5GB)', () => {
      expect(calculateRealUsableVram(8192)).toBe(4.5)
      expect(calculateRealUsableVram(16384)).toBe(10.5)
      expect(calculateRealUsableVram(0)).toBe(0)
    })
  })

  describe('calculateUsableSystemRamGB', () => {
    it('should calculate 70% of system RAM with minimum 2GB floor', () => {
      expect(calculateUsableSystemRamGB(32)).toBe(22.4)
      expect(calculateUsableSystemRamGB(16)).toBe(11.2)
      expect(calculateUsableSystemRamGB(2)).toBe(2.0)
    })
  })

  describe('resolveMaxContextTokens (RAM-Aware Context Scaling)', () => {
    it('should return 32768 for systems with >=24GB RAM on Medium/High/Extreme tiers', () => {
      const midHost = { hasGpu: true, vramTotalMB: 8192, systemRamGB: 32 }
      expect(resolveMaxContextTokens('Auto', midHost)).toBe(32768)

      const highHost = { hasGpu: true, vramTotalMB: 16384, systemRamGB: 32 }
      expect(resolveMaxContextTokens('Auto', highHost)).toBe(32768)
    })

    it('should return 16384 for Low tier with >=24GB RAM', () => {
      const cpuWorkstation = { hasGpu: false, systemRamGB: 32 }
      expect(resolveMaxContextTokens('Auto', cpuWorkstation)).toBe(16384)
    })

    it('should return 16384 for Medium tier with 16-23GB RAM', () => {
      const midHost16 = { hasGpu: true, vramTotalMB: 8192, systemRamGB: 16 }
      expect(resolveMaxContextTokens('Auto', midHost16)).toBe(16384)
    })

    it('should fall back to VRAM base context when RAM is <16GB', () => {
      const midHost8 = { hasGpu: true, vramTotalMB: 8192, systemRamGB: 8 }
      expect(resolveMaxContextTokens('Auto', midHost8)).toBe(8192)

      const legacyHost = { hasGpu: false, systemRamGB: 8 }
      expect(resolveMaxContextTokens('Auto', legacyHost)).toBe(4096)
    })

    it('should upgrade Low to Medium when enableSystemRamOffloading is true on Auto with >=16GB RAM', () => {
      const cpuHost = { hasGpu: false, systemRamGB: 32 }
      expect(resolveMaxContextTokens('Auto', cpuHost, true)).toBe(32768)
    })
  })
})
