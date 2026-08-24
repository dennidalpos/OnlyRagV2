/**
 * src/components/coding/promptFormatter.ts
 *
 * Formats user prompts for clean and ordered visual display in the Planner modal/panel.
 * Strictly preserves all original words, tokens, and characters without altering,
 * removing, or substituting any content.
 */

/**
 * Formats a user prompt string for readable and structured display in the UI.
 * - Preserves existing newlines and indentation.
 * - If single-line, intelligently inserts line breaks before inline numbered items,
 *   bullet points, step markers, or section headers without altering any words.
 */
export function formatPromptForDisplay(rawPrompt: string | null | undefined): string {
  if (!rawPrompt) return ''

  const text = rawPrompt.trim()
  if (!text) return ''

  // If the prompt already has multiple lines, normalize CRLF to LF and trim line ends
  if (text.includes('\n')) {
    return text
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .join('\n')
  }

  // If the prompt is a single line, format inline list markers and steps cleanly
  let formatted = text

  // 1. Break before inline numbered lists (e.g. "foo 2. bar 3. baz" or "foo 2) bar")
  // Avoid breaking decimals like 3.14 or version numbers like v1.2.3 by checking preceding whitespace/punctuation
  formatted = formatted.replace(/(?<=[^\s\d])\s+(\d+[\.\)]\s+)/g, '\n$1')

  // 2. Break before inline bullet markers (e.g. "foo - bar - baz" or "foo • bar • baz" or "foo * bar")
  formatted = formatted.replace(/(?<=[^\s])\s+([•\-\*]\s+)/g, '\n$1')

  // 3. Break before inline step/task headers (e.g. "foo Step 2: bar", "foo Passo 2: bar", "foo Fase 2:", "foo Task 2:")
  formatted = formatted.replace(
    /(?<=[^\s])\s+((?:Step|Passo|Phase|Fase|Task|Milestone|Punto)\s+\d+[:\-\s])/gi,
    '\n$1'
  )

  // 4. Break after semicolons if followed by bullet, number, or next instruction clause
  formatted = formatted.replace(/;\s+([•\-\*\d]|Step|Passo|Phase|Fase|Task|Punto)/gi, ';\n$1')

  return formatted
}
