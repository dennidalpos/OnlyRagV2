export interface SidecarState {
  isRunning: boolean
  port: number
  pid: number | null
  error: string | null
  lastHealthCheck: string | null
}

export interface IngestedDocument {
  id: string
  filename: string
  file_size: number
  num_pages: number
  num_chunks: number
  extractedMarkdown: string
  status: 'processing' | 'ready' | 'error'
  ingested_at: string
  file_type: string
}

export interface VectorSearchResult {
  chunk_id: string
  doc_id: string
  doc_name: string
  text: string
  score: number
}

export interface ExportResult {
  status: string
  format: string
  file_name: string
  file_path: string
  base64_content: string
  message: string
}
