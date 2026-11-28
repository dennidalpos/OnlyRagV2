/**
 * A `run_command` that only prints one workspace file (`cat`, `type`, `Get-Content`, `sed -n '1,200p'`,
 * `head`, `tail`, `shasum`). Live full task run of gpt-oss:20b, 2026-09-24: steps 16-41 were
 * `sed -n '1,200p' <file>` and `cat`/`shasum` reads instead of read_file, so no read ever carried a
 * [FILE VERSION] and every later overwrite of those files still lacked the version it needed.
 * The application runs such a command as read_file, which returns the same text plus the version.
 */

/** Characters that make a command more than one read: pipes, redirects, chaining, substitution, globs. */
const COMPOUND = /[|<>;&`$*?(){}]|\r|\n/

type ReadForm = { program: RegExp; flags: RegExp }

/** Each program with the flag tokens a plain read of a single file may carry. */
const READ_FORMS: ReadForm[] = [
  { program: /^(?:cat|type|more|nl)$/i, flags: /^-[nbA]$/ },
  { program: /^(?:get-content|gc)$/i, flags: /^-(?:path|literalpath|raw|encoding|utf8)$/i },
  { program: /^(?:head|tail)$/i, flags: /^(?:-n|-c|-\d+|\d+)$/ },
  // `sed -n 'N,Mp'` is a range print and nothing else.
  { program: /^sed$/i, flags: /^(?:-n|'?\d+(?:,\d+)?p'?|"?\d+(?:,\d+)?p"?)$/ },
  { program: /^(?:shasum|sha256sum|sha1sum|md5sum|get-filehash)$/i, flags: /^(?:-a|-algorithm|256|1|sha256|sha1|md5)$/i },
]

function unquote(token: string): string {
  return token.replace(/^(['"])(.*)\1$/, '$2')
}

/** The single file a read-only shell command prints, or null when the command does anything else. */
export function parseShellFileRead(command: string): string | null {
  const trimmed = (command || '').trim()
  if (!trimmed || COMPOUND.test(trimmed)) return null

  const tokens = trimmed.match(/'[^']*'|"[^"]*"|\S+/g) ?? []
  const [program, ...rest] = tokens
  const form = READ_FORMS.find((candidate) => candidate.program.test(program ?? ''))
  if (!form) return null

  const files = rest.filter((token) => !form.flags.test(token))
  if (files.length !== 1) return null
  const file = unquote(files[0])
  if (!file || file.startsWith('-') || /^[a-z]+:\/\//i.test(file)) return null
  return file
}
