import type { DiagnosticsData } from '../types'

/** Native RapidOCR execution provider as far as the runtime facts reported by the Sidecar go. */
export type NativeOcrProvider = 'cuda' | 'cpu' | 'unknown'

/**
 * Reads the provider only from an online Sidecar's `/health` OCR facts. Startup, offline state,
 * a missing field or an unrecognized value stay `unknown`: a static model or pipeline label never
 * implies acceleration.
 */
export function resolveNativeOcrProvider(diagnostics?: DiagnosticsData | null): NativeOcrProvider {
  if (diagnostics?.sidecar?.status !== 'online') return 'unknown'
  const provider = diagnostics.sidecar.ocr?.provider
  if (provider === 'CUDAExecutionProvider') return 'cuda'
  if (provider === 'CPUExecutionProvider') return 'cpu'
  return 'unknown'
}
