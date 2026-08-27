const URL_PATTERN = /\b(?:https?|ftp):\/\/[^\s"'<>]+/gi
const WINDOWS_PATH_PATTERN = /(?:[A-Za-z]:[\\/]|\\\\)[^\s"'<>]+/g
const POSIX_PATH_PATTERN = /(?<![\w])\/(?:[^\/\s"'<>]+\/)+[^\/\s"'<>]*/g
const EXCEPTION_DETAIL_PATTERN = /(^|\n)([^\n]*(?:failed|failure|error|exception|could not|unable)[^:\n]*:\s*)([^\n]+)/gi
const AUTH_HEADER_PATTERN = /(\b(?:authorization\s*:\s*bearer|proxy-authorization\s*:\s*bearer)\s+)[^\s,;]+/gi
const SECRET_ASSIGNMENT_PATTERN = /((?:["']?\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|token|authorization)\b["']?\s*[=:]\s*["']?(?:bearer\s+)?))[^\s"',;}]+/gi
const SECRET_QUERY_PATTERN = /([?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|token)=)[^&\s]+/gi

/** Shared redaction policy for all persisted operational and agent logs. */
export function sanitizeLogMessage(message: string): string {
  return String(message)
    .replace(AUTH_HEADER_PATTERN, '$1[redacted]')
    .replace(SECRET_ASSIGNMENT_PATTERN, '$1[redacted]')
    .replace(SECRET_QUERY_PATTERN, '$1[redacted]')
    .replace(URL_PATTERN, (url) => {
      const punctuation = url.match(/[.,;:!?)]*$/)?.[0] ?? ''
      return `[url]${punctuation}`
    })
    .replace(WINDOWS_PATH_PATTERN, '[path]')
    .replace(POSIX_PATH_PATTERN, '[path]')
    .replace(EXCEPTION_DETAIL_PATTERN, '$1$2[details redacted]')
}
