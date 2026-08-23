import { describe, expect, it } from 'vitest'
import { checkVerificationCommandSafety, unsafeVerificationNote } from './verificationCommandSafety'

describe('checkVerificationCommandSafety', () => {
  it('accepts the build, test and typecheck commands a plan legitimately cites', () => {
    for (const command of ['npm run build', 'npm test', 'tsc --noEmit', 'npm run lint', 'pytest -q', 'vite build']) {
      expect(checkVerificationCommandSafety(command)).toEqual({ isSafe: true })
    }
  })

  it('refuses the exact commands that corrupted session-1787497654743-4enx', () => {
    // Both ran as "verification" and left src/App.tsx and src/pages/Tasks.tsx as UTF-16
    // garbage, then reported "Verification command passed".
    expect(checkVerificationCommandSafety('touch src/App.tsx').isSafe).toBe(false)
    expect(
      checkVerificationCommandSafety('echo "import React from \'react\';\\n\\nfunction App() {}" > src/App.tsx').isSafe
    ).toBe(false)
    expect(checkVerificationCommandSafety('npm init -y').isSafe).toBe(false)
    expect(checkVerificationCommandSafety('npx tailwindcss init -p').isSafe).toBe(false)
  })

  it('sees a redirection even when the payload is JSX full of angle brackets', () => {
    const verdict = checkVerificationCommandSafety('echo "<div className=\\"flex\\">x</div>" > src/App.tsx')
    expect(verdict.isSafe).toBe(false)
    expect(verdict.reason).toMatch(/redirects output/)
  })

  it('does not mistake a handle redirection for a file write', () => {
    expect(checkVerificationCommandSafety('npm run build 2>&1').isSafe).toBe(true)
  })

  it('rejects append redirection', () => {
    expect(checkVerificationCommandSafety('npm test >> results.log').isSafe).toBe(false)
  })

  it('judges every segment of a command chain, not just the first', () => {
    expect(checkVerificationCommandSafety('npm test && touch done.flag').isSafe).toBe(false)
    expect(checkVerificationCommandSafety('npm run lint; rm -rf dist').isSafe).toBe(false)
  })

  it('identifies a command spelled as a path or with an extension', () => {
    expect(checkVerificationCommandSafety('C:\\tools\\touch.exe src/App.tsx').isSafe).toBe(false)
    expect(checkVerificationCommandSafety('./node_modules/.bin/tsc --noEmit').isSafe).toBe(true)
  })

  it('rejects PowerShell file-authoring cmdlets', () => {
    expect(checkVerificationCommandSafety('New-Item -ItemType File -Force -Path "src/App.tsx"').isSafe).toBe(false)
    expect(checkVerificationCommandSafety('Set-Content src/App.tsx "x"').isSafe).toBe(false)
    expect(checkVerificationCommandSafety('Out-File -FilePath src/App.tsx').isSafe).toBe(false)
  })

  it('rejects in-place stream editing', () => {
    expect(checkVerificationCommandSafety('sed -i s/a/b/ src/App.tsx').isSafe).toBe(false)
    expect(checkVerificationCommandSafety('sed -n 1,5p src/App.tsx').isSafe).toBe(true)
  })

  it('rejects commands that cannot fail, because promoting on their exit code is a rubber stamp', () => {
    for (const command of ['echo done', 'true', 'cd src', 'Write-Host ok', 'exit 0']) {
      const verdict = checkVerificationCommandSafety(command)
      expect(verdict.isSafe).toBe(false)
      expect(verdict.reason).toMatch(/never fail|proves nothing/)
    }
  })

  it('rejects scaffolding regardless of which tool spells it', () => {
    expect(checkVerificationCommandSafety('git init').isSafe).toBe(false)
    expect(checkVerificationCommandSafety('tsc --init').isSafe).toBe(false)
    expect(checkVerificationCommandSafety('npm create vite@latest').isSafe).toBe(false)
    expect(checkVerificationCommandSafety('npx create-react-app .').isSafe).toBe(false)
  })

  it('treats an empty or non-string command as unsafe rather than throwing', () => {
    expect(checkVerificationCommandSafety('').isSafe).toBe(false)
    expect(checkVerificationCommandSafety('   ').isSafe).toBe(false)
    expect(checkVerificationCommandSafety(undefined as unknown as string).isSafe).toBe(false)
  })

  it('always explains a refusal', () => {
    const verdict = checkVerificationCommandSafety('touch x')
    expect(verdict.reason).toBeTruthy()
  })
})

describe('unsafeVerificationNote', () => {
  it('names the command and the reason so the plan says why nothing was run', () => {
    const note = unsafeVerificationNote('touch src/App.tsx', 'because reasons')
    expect(note).toContain('touch src/App.tsx')
    expect(note).toContain('because reasons')
  })
})
