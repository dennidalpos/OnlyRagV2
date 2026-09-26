/**
 * A diagnostic's recommended fix, kept as data so that only planDirectiveArbiter turns one into an
 * order. Tool results render it as advice: a turn then carries at most one order, the arbiter's,
 * instead of a tool-result order competing with the directive in the turn context.
 */
export interface DiagnosticAdvice {
  /** Bracketed heading, e.g. `[STYLESHEET SYNTAX ERROR — "src/index.css"]`. */
  heading: string
  /** What was observed: error lines, names, reasons. */
  facts: readonly string[]
  /** The next tool call without a lead-in, e.g. `"write_file" on "src/App.tsx": the complete file ...`. */
  nextCall: string
  /** The steps and limits that follow the call, e.g. `Then run the build again.` */
  constraints: readonly string[]
}

/** Heads the steps of advice; the directive in the turn context, when there is one, takes precedence. */
export const ADVICE_LABEL = 'Suggested fix (advice; the turn context carries the one directive for this turn):'

/**
 * Wording that only an order carries: tool results and gate refusals must never contain it.
 * @internal
 */
export const ORDER_MARKER = /\bDirectives:|\bMUST\b/

export function diagnosticAdvice(
  heading: string,
  facts: readonly (string | false | null | undefined)[],
  nextCall: string,
  constraints: readonly string[] = [],
): DiagnosticAdvice {
  return { heading, facts: facts.filter((fact): fact is string => Boolean(fact)), nextCall, constraints }
}

function numberedConstraints(advice: DiagnosticAdvice): string[] {
  return advice.constraints.map((constraint, index) => `${index + 2}. ${constraint}`)
}

/** The form a tool result carries. */
export function renderAdvice(advice: DiagnosticAdvice): string {
  return [advice.heading, ...advice.facts, ADVICE_LABEL, `1. Next tool call: ${advice.nextCall}`, ...numberedConstraints(advice)].join('\n')
}

/**
 * Reads back advice that renderAdvice wrote into a tool result, starting at its heading. Recorded
 * tool results persist only as text, and the arbiter re-reads them to see which fix is still owed.
 */
export function parseRenderedAdvice(text: string): DiagnosticAdvice | null {
  const lines = text.split('\n')
  const labelIndex = lines.indexOf(ADVICE_LABEL)
  const call = lines[labelIndex + 1]?.match(/^1\. Next tool call: (.+)$/)
  if (labelIndex < 1 || !call) return null
  const constraints: string[] = []
  for (const line of lines.slice(labelIndex + 2)) {
    const step = line.match(/^\d+\. (.+)$/)
    if (!step) break
    constraints.push(step[1])
  }
  return { heading: lines[0], facts: lines.slice(1, labelIndex), nextCall: call[1], constraints }
}

/** The form only planDirectiveArbiter emits, as the single directive of a turn. */
export function renderOrder(advice: DiagnosticAdvice): string {
  return [advice.heading, ...advice.facts, 'Directives:', `1. Your next tool call MUST be ${advice.nextCall}`, ...numberedConstraints(advice)].join('\n')
}
