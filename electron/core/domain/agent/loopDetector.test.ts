import { describe, it, expect, beforeEach } from 'vitest'
import { AgentActionLoopDetector } from './loopDetector'
import type { AgentToolCall } from './agentTypes'

describe('AgentActionLoopDetector Unit Tests', () => {
  let detector: AgentActionLoopDetector

  beforeEach(() => {
    detector = new AgentActionLoopDetector(2)
  })

  it('should generate deterministic fingerprints for identical tool calls', () => {
    const call1: AgentToolCall = {
      tool: 'read_file',
      parameters: { filePath: 'src/index.ts', startLine: 1, endLine: 50 },
    }
    const call2: AgentToolCall = {
      tool: 'read_file',
      parameters: { filePath: 'src/index.ts', startLine: 1, endLine: 50 },
    }

    const fp1 = detector.generateFingerprint(call1)
    const fp2 = detector.generateFingerprint(call2)

    expect(fp1).toBe(fp2)
    expect(fp1).toHaveLength(64)
  })

  it('should generate distinct fingerprints for different tool calls', () => {
    const call1: AgentToolCall = {
      tool: 'read_file',
      parameters: { filePath: 'src/index.ts' },
    }
    const call2: AgentToolCall = {
      tool: 'write_file',
      parameters: { filePath: 'src/index.ts', content: 'test' },
    }

    const fp1 = detector.generateFingerprint(call1)
    const fp2 = detector.generateFingerprint(call2)

    expect(fp1).not.toBe(fp2)
  })

  it('should allow tool execution within tolerance without triggering loop alarm', () => {
    const call: AgentToolCall = {
      tool: 'run_command',
      parameters: { command: 'npm test' },
    }

    const res1 = detector.recordAndCheck(call)
    expect(res1.isLooping).toBe(false)
    expect(res1.consecutiveDuplicateCount).toBe(1)

    const res2 = detector.recordAndCheck(call)
    expect(res2.isLooping).toBe(false)
    expect(res2.consecutiveDuplicateCount).toBe(2)
  })

  it('should trigger loop intervention when duplicate threshold is exceeded', () => {
    const call: AgentToolCall = {
      tool: 'replace_file_content',
      parameters: { filePath: 'main.ts', targetContent: 'foo', replacementContent: 'bar' },
    }

    detector.recordAndCheck(call)
    detector.recordAndCheck(call)
    const res3 = detector.recordAndCheck(call)

    expect(res3.isLooping).toBe(true)
    expect(res3.consecutiveDuplicateCount).toBe(3)
    expect(res3.suggestedIntervention).toContain('[CRITICAL LOOP INTERVENTION')
  })

  it('should detect file edit thrashing when 4 distinct edits target the same file in a row, regardless of tool mix', () => {
    const call1: AgentToolCall = { tool: 'write_file', parameters: { filePath: 'src/config.ts', content: 'port = 3000' } }
    const call2: AgentToolCall = {
      tool: 'replace_file_content',
      parameters: { filePath: 'src/config.ts', targetContent: 'port = 3000', replacementContent: 'port = 8080' },
    }
    const call3: AgentToolCall = {
      tool: 'replace_file_content',
      parameters: { filePath: 'src/config.ts', targetContent: 'port = 8080', replacementContent: 'port = 9000' },
    }
    const call4: AgentToolCall = {
      tool: 'replace_file_content',
      parameters: { filePath: 'src/config.ts', targetContent: 'port = 9000', replacementContent: 'port = 9090' },
    }

    const res1 = detector.recordAndCheck(call1)
    expect(res1.isLooping).toBe(false)
    const res2 = detector.recordAndCheck(call2)
    expect(res2.isLooping).toBe(false)
    const res3 = detector.recordAndCheck(call3)
    expect(res3.isLooping).toBe(false)

    const res4 = detector.recordAndCheck(call4)
    expect(res4.isLooping).toBe(true)
    expect(res4.suggestedIntervention).toContain('[CRITICAL FILE EDIT LOOP: 4 EDITS ON src/config.ts WITHOUT VERIFICATION]')
    expect(res4.suggestedIntervention).toContain('before editing "src/config.ts" again')
  })

  it('should detect redundant write_file loops when same target is written multiple times', () => {
    const call1: AgentToolCall = { tool: 'write_file', parameters: { filePath: 'src/App.tsx', content: 'content 1' } }
    const call2: AgentToolCall = { tool: 'write_file', parameters: { filePath: 'src/App.tsx', content: 'content 2' } }
    const call3: AgentToolCall = { tool: 'write_file', parameters: { filePath: 'src/App.tsx', content: 'content 3' } }
    const call4: AgentToolCall = { tool: 'write_file', parameters: { filePath: 'src/App.tsx', content: 'content 4' } }

    detector.recordAndCheck(call1)
    detector.recordAndCheck(call2)
    detector.recordAndCheck(call3)
    const res4 = detector.recordAndCheck(call4)

    expect(res4.isLooping).toBe(true)
    expect(res4.suggestedIntervention).toContain('[CRITICAL FILE EDIT LOOP: 4 EDITS ON src/App.tsx WITHOUT VERIFICATION]')
  })

  it('should detect redundant read loops when same target is read 4+ consecutive times', () => {
    const call1: AgentToolCall = {
      tool: 'read_file',
      parameters: { filePath: 'src/App.tsx', startLine: 1, endLine: 50 },
    }
    const call2: AgentToolCall = {
      tool: 'read_file',
      parameters: { filePath: 'src/App.tsx', startLine: 51, endLine: 100 },
    }
    const call3: AgentToolCall = {
      tool: 'read_file',
      parameters: { filePath: 'src/App.tsx', startLine: 1, endLine: 100 },
    }
    const call4: AgentToolCall = {
      tool: 'read_file',
      parameters: { filePath: 'src/App.tsx', startLine: 1, endLine: 200 },
    }

    detector.recordAndCheck(call1)
    detector.recordAndCheck(call2)
    detector.recordAndCheck(call3)
    const res4 = detector.recordAndCheck(call4)

    expect(res4.isLooping).toBe(true)
    expect(res4.suggestedIntervention).toContain('[CRITICAL READ LOOP INTERVENTION: REPEATED READS ON src/App.tsx]')
  })

  it('should reset target history cleanly allowing fresh edit attempt after intervention', () => {
    const call1: AgentToolCall = { tool: 'replace_file_content', parameters: { filePath: 'src/App.tsx', targetContent: 'a', replacementContent: 'b' } }
    const call2: AgentToolCall = { tool: 'replace_file_content', parameters: { filePath: 'src/App.tsx', targetContent: 'c', replacementContent: 'd' } }
    const call3: AgentToolCall = { tool: 'replace_file_content', parameters: { filePath: 'src/App.tsx', targetContent: 'e', replacementContent: 'f' } }
    const call4: AgentToolCall = { tool: 'replace_file_content', parameters: { filePath: 'src/App.tsx', targetContent: 'g', replacementContent: 'h' } }

    detector.recordAndCheck(call1)
    detector.recordAndCheck(call2)
    detector.recordAndCheck(call3)
    const res4 = detector.recordAndCheck(call4)
    expect(res4.isLooping).toBe(true)

    // Reset target after intervention
    detector.resetTarget('src/App.tsx')

    // Next corrective action (e.g. write_file) should not be blocked immediately
    const correctiveCall: AgentToolCall = { tool: 'write_file', parameters: { filePath: 'src/App.tsx', content: '// clean rewrite' } }
    const res5 = detector.recordAndCheck(correctiveCall)
    expect(res5.isLooping).toBe(false)
  })

  it('should reset history cleanly', () => {
    const call: AgentToolCall = {
      tool: 'list_dir',
      parameters: { dirPath: '.' },
    }

    detector.recordAndCheck(call)
    detector.recordAndCheck(call)
    expect(detector.historyLength).toBe(2)

    detector.reset()
    expect(detector.historyLength).toBe(0)
  })

  it('does not treat a second run of the same command as a loop within tolerance', () => {
    const call: AgentToolCall = { tool: 'run_command', parameters: { command: 'npm run typecheck' } }

    const res1 = detector.recordAndCheck(call)
    expect(res1.isLooping).toBe(false)

    const res2 = detector.recordAndCheck(call)
    expect(res2.isLooping).toBe(false)
  })
  describe('repeat outcome classification', () => {
    const installCall: AgentToolCall = { tool: 'run_command', parameters: { command: 'npm install' } }

    /** Mirrors the orchestrator: check before the tool runs, report the outcome after it ran. */
    const runStep = (call: AgentToolCall, succeeded: boolean) => {
      const res = detector.recordAndCheck(call)
      if (!res.isLooping) detector.recordOutcome(call, succeeded)
      return res
    }

    // Distinct paths keep the alternation below from reading as an edit/command oscillation.
    const fixCall = (content: string, filePath = `src/${content}.ts`): AgentToolCall => ({ tool: 'write_file', parameters: { filePath, content } })

    it('does not treat a check re-run after each successful fix as a repeat', () => {
      runStep(installCall, false)
      runStep(fixCall('a'), true)
      runStep(installCall, false)
      runStep(fixCall('b'), true)
      const retried = runStep(installCall, false)

      // Edit, check, edit, check is the normal fix cycle; runs 38 and 41 needed seven test runs to pass.
      expect(retried.isLooping).toBe(false)
    })

    it('classifies a repeat as succeeding when every earlier execution succeeded', () => {
      runStep(installCall, true)
      runStep(installCall, true)
      const blocked = runStep(installCall, true)

      expect(blocked.isLooping).toBe(true)
      expect(blocked.repeatOutcome).toBe('succeeding')
      expect(blocked.suggestedIntervention).toContain('[REDUNDANT ACTION: "run_command" ALREADY SUCCEEDED 2 TIME(S)]')
      // The failing-loop advice would send the model hunting for an error that never happened.
      expect(blocked.suggestedIntervention).not.toContain('investigate the error stack trace')
    })

    it('allows a command that succeeded and then broke to run again after a fix', () => {
      runStep(installCall, true)
      runStep(installCall, false)
      runStep(fixCall('a'), true)

      expect(runStep(installCall, false).isLooping).toBe(false)
    })

    it('refuses a failed check re-issued with nothing changed since, before it runs', () => {
      const buildCall: AgentToolCall = { tool: 'run_command', parameters: { command: 'npm run build' } }
      runStep(buildCall, false)
      const blocked = runStep(buildCall, false)

      expect(blocked).toMatchObject({ isLooping: true, pattern: 'unchanged_failing_repeat', repeatOutcome: 'failing' })
      expect(blocked.suggestedIntervention).toContain('[UNCHANGED RETRY BLOCKED: "npm run build"')
      expect(blocked.suggestedIntervention).toContain('It was NOT executed.')
    })

    it('allows the failed check again once a file edit or another command ran', () => {
      const buildCall: AgentToolCall = { tool: 'run_command', parameters: { command: 'npm run build' } }
      runStep(buildCall, false)
      runStep(fixCall('a'), true)
      expect(runStep(buildCall, false).isLooping).toBe(false)
    })

    it('lets a failed command lift the block too, since it may still have changed the workspace', () => {
      const buildCall: AgentToolCall = { tool: 'run_command', parameters: { command: 'npm run build' } }
      runStep(buildCall, false)
      runStep(installCall, false)
      expect(runStep(buildCall, false).isLooping).toBe(false)
    })

    it('keeps the block when only reads or rejected edits happened in between', () => {
      const buildCall: AgentToolCall = { tool: 'run_command', parameters: { command: 'npm run build' } }
      runStep(buildCall, false)
      runStep({ tool: 'read_file', parameters: { filePath: 'src/a.ts' } }, true)
      runStep(fixCall('rejected'), false)

      expect(runStep(buildCall, false).pattern).toBe('unchanged_failing_repeat')
    })

    it('never blocks a check whose last run succeeded, nor non-check tools', () => {
      const buildCall: AgentToolCall = { tool: 'run_command', parameters: { command: 'npm run build' } }
      runStep(buildCall, false)
      runStep(fixCall('a'), true)
      runStep(buildCall, true)
      expect(runStep(buildCall, true).pattern).not.toBe('unchanged_failing_repeat')

      runStep(fixCall('rejected'), false)
      expect(runStep(fixCall('rejected'), false).isLooping).toBe(false)
    })

    it('falls back to the failing-loop advice while no outcome has been reported yet', () => {
      detector.recordAndCheck(installCall)
      detector.recordAndCheck(installCall)
      const blocked = detector.recordAndCheck(installCall)

      expect(blocked.isLooping).toBe(true)
      expect(blocked.repeatOutcome).toBe('unknown')
      expect(blocked.suggestedIntervention).toContain('[CRITICAL LOOP INTERVENTION')
    })

    it('keeps outcome memory across resetTarget so a later repeat is still read as successful', () => {
      detector.recordOutcome(installCall, true)
      detector.resetTarget('npm install')

      expect(detector.classifyRepeatOutcome(installCall)).toBe('succeeding')
    })

    it('drops outcome memory on a full reset', () => {
      detector.recordOutcome(installCall, true)
      detector.reset()

      expect(detector.classifyRepeatOutcome(installCall)).toBe('unknown')
    })

    describe('rewriting one file with different content each time', () => {
      // The file-edit thrashing rule fires on the TARGET, not the fingerprint, so every one of these calls is a fresh signature.
      const editCall = (content: string): AgentToolCall => ({
        tool: 'write_file',
        parameters: { filePath: 'src/styles/globals.css', content },
      })

      /** Four edits to one file, each with different content, each reported as successful. */
      const thrashFile = (succeeded: boolean) => {
        let last = detector.recordAndCheck(editCall('a'))
        for (const content of ['b', 'c', 'd']) {
          detector.recordOutcome(editCall(content), succeeded)
          last = detector.recordAndCheck(editCall(content))
        }
        return last
      }

      it('is classified as succeeding once the edits are known to have landed', () => {
        const last = thrashFile(true)

        expect(last.isLooping).toBe(true)
        expect(last.suggestedIntervention).toContain('CRITICAL FILE EDIT LOOP')
        expect(last.repeatOutcome).toBe('succeeding')
      })

      it('stays failing when the edits to that file have been failing', () => {
        expect(thrashFile(false).repeatOutcome).toBe('failing')
      })

      it('leaves a read loop on the stagnation ladder, since repeated reads produce nothing', () => {
        const readCall: AgentToolCall = { tool: 'read_file', parameters: { filePath: 'src/App.tsx' } }
        let last = detector.recordAndCheck(readCall)
        for (let i = 0; i < 4; i++) {
          detector.recordOutcome(readCall, true)
          last = detector.recordAndCheck(readCall)
        }

        expect(last.isLooping).toBe(true)
      })
    })
  })
})

describe('cycle detection keys edits by content', () => {
  const build: AgentToolCall = { tool: 'run_command', parameters: { command: 'npm run build' } }
  const write = (content: string): AgentToolCall => ({ tool: 'write_file', parameters: { filePath: 'src/index.css', content } })

  it('lets a different fix follow each failed build', () => {
    const detector = new AgentActionLoopDetector(2)
    for (const call of [write('a'), build, write('b'), build, write('c')]) {
      expect(detector.recordAndDetectCycle(call.tool, call.parameters).isOscillating).toBe(false)
    }
  })

  it('still catches the same fix and the same build alternating', () => {
    const detector = new AgentActionLoopDetector(2)
    const results = [write('a'), build, write('a'), build].map((call) => detector.recordAndDetectCycle(call.tool, call.parameters))
    expect(results.at(-1)?.isOscillating).toBe(true)
  })
})

describe('same-file edit streaks end at a check', () => {
  const edit = (content: string): AgentToolCall => ({ tool: 'write_file', parameters: { filePath: 'package.json', content } })
  const build: AgentToolCall = { tool: 'run_command', parameters: { command: 'npm run build' } }

  it('blocks a fourth unverified edit of one file', () => {
    const detector = new AgentActionLoopDetector(2)
    const results = ['a', 'b', 'c', 'd'].map((content) => detector.recordAndCheck(edit(content)))
    expect(results.at(-1)).toMatchObject({ isLooping: true, pattern: 'same_file_edits' })
  })

  it('lets corrections resume once a check has run', () => {
    const detector = new AgentActionLoopDetector(2)
    for (const content of ['a', 'b', 'c']) detector.recordAndCheck(edit(content))
    detector.recordAndCheck(build)
    detector.recordOutcome(build, false)

    expect(detector.recordAndCheck(edit('d')).isLooping).toBe(false)
  })
})

describe('fix cycles are not loops', () => {
  it('lets edit, build, edit, build run without an exact-repeat block', () => {
    const detector = new AgentActionLoopDetector()
    const build = { tool: 'run_command' as const, parameters: { command: 'npm run build' } }
    for (let attempt = 0; attempt < 4; attempt++) {
      const edit = {
        tool: 'replace_file_content' as const,
        parameters: { filePath: 'src/App.tsx', targetContent: `v${attempt}`, replacementContent: `v${attempt + 1}` },
      }
      expect(detector.recordAndCheck(edit).isLooping).toBe(false)
      detector.recordOutcome(edit, true)
      expect(detector.recordAndCheck(build).isLooping).toBe(false)
      detector.recordOutcome(build, false)
    }
  })

  it('still stops the same build re-run with nothing edited in between', () => {
    const detector = new AgentActionLoopDetector()
    const build = { tool: 'run_command' as const, parameters: { command: 'npm run build' } }
    const results = [0, 1, 2, 3].map(() => {
      const check = detector.recordAndCheck(build)
      detector.recordOutcome(build, true)
      return check.isLooping
    })
    expect(results).toContain(true)
  })
})
