import { z } from 'zod'
import type { MissingDependencyMap } from '../../domain/agent/dependencyIntegrityGate'

export interface DependencyScanResult {
  missing: MissingDependencyMap
  peerProviders?: Record<string, string>
  scanned: boolean
}

export const dependencyScanResponseSchema = z.object({
  result: z.object({
    missing: z.record(z.string(), z.array(z.string())),
    peerProviders: z.record(z.string(), z.string()).optional(),
    scanned: z.literal(true),
  }),
  heapUsedBytes: z.number().nonnegative(),
})
