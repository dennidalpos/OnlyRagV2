/**
 * Entrypoint Integrity.
 *
 * Answers the one question no compiler will ever answer: does the page that starts the
 * application actually load the application?
 *
 * A typecheck reads every file the project declares and says whether the code is correct. It
 * cannot say whether anything is wired to run. Measured on 2026-08-25: `npx tsc --noEmit`
 * passed cleanly over the whole workspace and the plan reached 14/15 verified, while
 * `vite build` reported `2 modules transformed` and emitted a 0.25 kB `index.html` and no
 * JavaScript at all — because that `index.html` carried no `<script>` tag pointing at
 * `src/main.tsx`. Every component was type-correct and none of them was ever loaded.
 *
 * The file is not malformed, which is exactly why nothing catches it: it is valid HTML that
 * happens to reference nothing. A person sees it in a second; the toolchain never does.
 *
 * Pure domain: the caller supplies the HTML and whether a module entry exists on disk.
 */

/** Entry files a bundler-based web project is expected to boot from, in preference order. */
export const CONVENTIONAL_ENTRY_PATHS = [
  'src/main.tsx',
  'src/main.ts',
  'src/main.jsx',
  'src/main.js',
  'src/index.tsx',
  'src/index.ts',
  'src/index.jsx',
  'src/index.js',
]

/** `<script ... src="..."></script>`, with the src captured. Attribute order is not assumed. */
const SCRIPT_SRC_PATTERN = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi

/**
 * Every local script the page loads. Absolute URLs are ignored: a CDN tag is not this
 * project's entry, and treating it as one would silence the check for exactly the pages that
 * load a framework from elsewhere and their own code from nowhere.
 */
export function extractLocalScriptSources(html: string): string[] {
  const found: string[] = []
  for (const match of (html || '').matchAll(SCRIPT_SRC_PATTERN)) {
    const src = match[1].trim()
    if (!src || /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//')) continue
    found.push(src)
  }
  return found
}

export interface EntrypointVerdict {
  /** False only when the page demonstrably loads nothing of this project's own code. */
  ok: boolean
  /** The entry the project has on disk and the page fails to reference. */
  expectedEntry?: string
}

/**
 * Whether the HTML entry page loads the project's own code.
 *
 * Reports a problem only when BOTH halves are certain: the project has a conventional module
 * entry on disk, and the page references no local script at all. A page that loads some other
 * local script is left alone — the project may boot in a way this rule does not model, and a
 * false accusation here would send the model rewriting a file that was already correct.
 */
export function checkHtmlEntrypoint(html: string, entryPathsOnDisk: readonly string[]): EntrypointVerdict {
  const entry = CONVENTIONAL_ENTRY_PATHS.find((candidate) => entryPathsOnDisk.includes(candidate))
  if (!entry) return { ok: true }
  if (extractLocalScriptSources(html).length > 0) return { ok: true }
  return { ok: false, expectedEntry: entry }
}

/**
 * What the model is told when the page loads nothing.
 *
 * Names the exact tag, because "wire up the entrypoint" is the kind of instruction a small
 * model answers by rewriting the whole file into something else. It also states the reason the
 * check passed anyway — otherwise the model has just been told its verified project is broken,
 * with no way to reconcile the two.
 */
export function buildEntrypointDirective(htmlPath: string, expectedEntry: string): string {
  return [
    `[THE PAGE LOADS NOTHING — "${htmlPath}" DOES NOT REFERENCE THE APPLICATION]`,
    `"${expectedEntry}" exists, but "${htmlPath}" contains no <script> tag pointing at it, so the bundler compiles nothing and the application never starts.`,
    `A typecheck cannot catch this: the code is correct, it is simply never loaded. That is why the project can look verified and still do nothing.`,
    `Directives:`,
    `1. Your next tool call MUST be "write_file" on "${htmlPath}", keeping the existing markup and adding, inside <body>: <div id="root"></div> followed by <script type="module" src="/${expectedEntry}"></script>`,
    `2. Do not move "${expectedEntry}" or rename it. The page is what is wrong, not the entry.`,
  ].join('\n')
}
