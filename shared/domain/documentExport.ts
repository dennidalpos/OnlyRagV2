/** Formats accepted by the desktop export boundary; htm is an alias for HTML. */
export const DOCUMENT_EXPORT_FORMATS = ['pdf', 'docx', 'md', 'html', 'htm'] as const
export type DocumentExportFormat = (typeof DOCUMENT_EXPORT_FORMATS)[number]
