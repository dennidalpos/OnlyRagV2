import { describe, expect, it } from 'vitest'
import { checkVerificationCommandSafety, unsafeVerificationNote } from '../../../../shared/domain/agent/verificationCommandSafety'

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

  it('refuses the interactive editor commands that stalled session-1787518626817-72a8', () => {
    // The planner declared `nano <file>` as the verification for six of ten implementation
    // milestones. It cannot be run non-interactively: without a TTY it hangs until the
    // run_command timeout, and even with one its exit code only reports whether the editor
    // closed, never whether the file is correct. Every milestone that carried it was
    // eventually abandoned by the loop guard.
    for (const command of [
      'nano tailwind.config.js',
      'nano src/App.tsx',
      'vim src/index.html',
      'vi src/App.tsx',
      'emacs src/pages/Dashboard.tsx',
      'C:\\tools\\nano.exe src/App.tsx',
    ]) {
      const verdict = checkVerificationCommandSafety(command)
      expect(verdict.isSafe).toBe(false)
      expect(verdict.reason).toMatch(/interactive editor|pager/)
    }
  })

  it('refuses dev/watch servers that never exit, the same shape run_command already blocks at execution time', () => {
    // The same session declared `npx tailwindcss ... --watch` as the verification for two
    // milestones. run_command's BLOCKING_DEV_SERVER_BLOCK guard correctly refuses to execute
    // it, but only once the model tries — by then the milestone already carries a "proof"
    // that can never run to completion.
    for (const command of [
      'npx tailwindcss -i ./src/styles/globals.css -o ./dist/output.css --watch',
      'npm run dev',
      'vite',
      'next dev',
      'nodemon src/index.js',
      'jest --watchAll',
    ]) {
      const verdict = checkVerificationCommandSafety(command)
      expect(verdict.isSafe).toBe(false)
      expect(verdict.reason).toMatch(/never exits/)
    }
  })

  it('still allows one-shot build/test commands that happen to mention a dev-server tool by name', () => {
    expect(checkVerificationCommandSafety('vite build').isSafe).toBe(true)
    expect(checkVerificationCommandSafety('npm run build').isSafe).toBe(true)
    expect(checkVerificationCommandSafety('npx vitest run').isSafe).toBe(true)
  })

  it('rejects scaffolding regardless of which tool spells it', () => {
    expect(checkVerificationCommandSafety('git init').isSafe).toBe(false)
    expect(checkVerificationCommandSafety('tsc --init').isSafe).toBe(false)
    expect(checkVerificationCommandSafety('npm create vite@latest').isSafe).toBe(false)
    expect(checkVerificationCommandSafety('npx create-react-app .').isSafe).toBe(false)
  })

  it('refuses a command that only prints the file the milestone just wrote', () => {
    // Seven of fifteen milestones in session-1787562597025-q8a5 declared exactly this shape.
    for (const command of [
      'cat src/App.tsx',
      'cat index.html',
      'type vite.config.ts',
      'Get-Content src/styles/globals.css',
      'gc package.json',
      'head -n 20 src/main.tsx',
      'tail src/pages/Tasks.tsx',
      'ls src/components',
      'dir src',
      'Test-Path tsconfig.json',
    ]) {
      const verdict = checkVerificationCommandSafety(command)
      expect(verdict.isSafe, command).toBe(false)
      expect(verdict.reason, command).toBeTruthy()
    }
  })

  it('still accepts a content search, which fails when the file exists but is wrong', () => {
    for (const command of [
      'grep -q "createRoot" src/main.tsx',
      'findstr /C:"createRoot" src\\main.tsx',
      'Select-String -Pattern "createRoot" src/main.tsx',
    ]) {
      expect(checkVerificationCommandSafety(command).isSafe, command).toBe(true)
    }
  })

  it('refuses a test runner started in its windowed mode but keeps the headless one', () => {
    for (const command of [
      'npx cypress open',
      'cypress open',
      'npx playwright test --ui',
      'npx playwright test --headed',
    ]) {
      expect(checkVerificationCommandSafety(command).isSafe, command).toBe(false)
    }
    for (const command of ['npx cypress run', 'npx playwright test', 'npx vitest run']) {
      expect(checkVerificationCommandSafety(command).isSafe, command).toBe(true)
    }
  })

  it('refuses a command that hands the workspace to a graphical application', () => {
    for (const command of ['start index.html', 'open dist/index.html', 'xdg-open dist/index.html', 'code .']) {
      expect(checkVerificationCommandSafety(command).isSafe, command).toBe(false)
    }
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
