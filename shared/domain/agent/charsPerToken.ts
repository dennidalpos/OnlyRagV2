/**
 * Chars per BPE token for this app's prompt mix (English/Italian prose, markdown, code). The one
 * ratio used wherever a token budget is converted to characters or a count must be approximated;
 * it leans conservative, so char budgets derived from it undershoot rather than overflow.
 *
 * Kept in its own dependency-free module: importing it must not pull gpt-tokenizer (~2 MB) into
 * the renderer's initial bundle.
 */
export const APPROX_CHARS_PER_TOKEN = 3.5
