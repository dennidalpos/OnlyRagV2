export interface SidecarHealthResponse {
  status: 'online'
  engine: string
  version: string
  vector_db: string
  gpu: Record<string, unknown>
  ocr: Record<string, unknown>
  documents_count: number
  chunks_count: number
  python_version: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseSidecarHealthResponse(value: unknown): SidecarHealthResponse | null {
  if (!isRecord(value) || value.status !== 'online') return null
  if (typeof value.engine !== 'string' || typeof value.version !== 'string') return null
  if (typeof value.vector_db !== 'string' || typeof value.python_version !== 'string') return null
  if (!isRecord(value.gpu) || !isRecord(value.ocr)) return null
  if (!Number.isInteger(value.documents_count) || (value.documents_count as number) < 0) return null
  if (!Number.isInteger(value.chunks_count) || (value.chunks_count as number) < 0) return null
  return value as unknown as SidecarHealthResponse
}
