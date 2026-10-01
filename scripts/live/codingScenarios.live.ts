import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AgentApprovalRequest, UserInterviewAnswer } from '../../shared/types'
import type { RendererEventSink } from '../../electron/core/domain/ports/rendererEventSink'
import { createAgentRunIdentity } from '../../shared/domain/agent/agentRunIdentity'
import { cancelActiveAgentTask, respondToApproval, runAgentOrchestratorLoop } from '../../electron/core/application/agentOrchestratorAppService'
import { agentSessionStateRepository } from '../../electron/core/infrastructure/filesystem/agentSessionStateRepository'
import { createQwen35Campaign } from './qwen35Campaign'
import { snapshotLiveAuditLogs } from './agentLiveHarness'
import { agentInterviewAppService } from '../../electron/core/application/agentInterviewAppService'
import { QWEN35_MODEL } from './qwen35Campaign'

describe('live: isolated 9B execution and policy fixtures', () => {
  let campaign: Awaited<ReturnType<typeof createQwen35Campaign>>
  beforeAll(async () => {
    campaign = await createQwen35Campaign('coding-scenarios-9b-thinking', {
      temperature: 1,
      top_p: 0.95,
      top_k: 20,
      min_p: 0,
      presence_penalty: 1.5,
      repeat_penalty: 1,
    })
  })
  afterAll(async () => {
    if (campaign) await campaign.close()
  })

  function fixture(name: string) {
    const root = path.join(campaign.root, name)
    const workspace = path.join(root, 'workspace')
    fs.mkdirSync(path.join(workspace, 'src'), { recursive: true })
    const identity = createAgentRunIdentity({ conversationId: `fixture-${randomUUID()}`, workspacePath: workspace, planRevisionId: randomUUID() })
    const save = (name: string, value: unknown) => fs.writeFileSync(path.join(root, name), JSON.stringify(value, null, 2), 'utf8')
    return { root, workspace, identity, save }
  }

  async function run(
    target: ReturnType<typeof fixture>,
    prompt: string,
    mode: 'ask' | 'guided' | 'auto',
    consent: 'accept' | 'deny-and-cancel' | 'deny-and-continue',
    rejectOnly?: 'git_commit',
    beforeApproval?: (request: AgentApprovalRequest) => void,
  ) {
    const events: Array<{ channel: string; payload: unknown }> = []
    const sink: RendererEventSink = {
      isAvailable: () => true,
      send(channel, payload) {
        events.push({ channel, payload })
        if (channel !== 'agent:approval-request') return
        const request = payload as AgentApprovalRequest
        const rejected = consent !== 'accept' && (!rejectOnly || request.type === rejectOnly)
        const approved =
          !rejected &&
          request.type !== 'git_commit' &&
          Boolean(request.reasons?.length) &&
          request.reasons!.every((reason) => ['workspace_mutation', 'guided_review', 'network_access'].includes(reason))
        beforeApproval?.(request)
        expect(respondToApproval(request, approved)).toBe(true)
        target.save('events.json', events)
        // Declared stop fixture: cancellation follows a refused proposal, before execution.
        if (rejected && consent === 'deny-and-cancel') queueMicrotask(() => cancelActiveAgentTask(target.identity.runId))
      },
    }
    target.save('input.json', {
      identity: target.identity,
      prompt,
      mode,
      consent,
      rejectOnly,
      scope: 'Executor/policy fixture with a declared seed; does not replace interview/planning or qualify TaskLab.',
      cancellation:
        consent === 'deny-and-cancel' ? 'Intentional stop immediately after rejection; ordinary denial recovery remains deterministic evidence.' : null,
    })
    try {
      const result = await runAgentOrchestratorLoop(
        {
          identity: target.identity,
          sessionId: target.identity.conversationId,
          userTask: prompt,
          workspacePath: target.workspace,
          agentMode: mode,
          settings: campaign.settings,
        },
        sink,
      )
      target.save('execution.json', result)
      return result
    } finally {
      target.save('events.json', events)
      target.save('session.json', await agentSessionStateRepository.loadSessionState(target.identity.conversationId, target.workspace))
      snapshotLiveAuditLogs({ sessionId: target.identity.conversationId, label: path.basename(target.root), destinationRoot: path.join(target.root, 'audit') })
    }
  }

  it('reads ranges, metadata, symbols and search in Ask without mutations', async () => {
    const target = fixture('ask-read-only')
    const source = '// Fixture: read-only module\nexport const value = 2\nexport function double(input) {\n  return input * 2\n}\n'
    fs.writeFileSync(path.join(target.workspace, 'src/value.mjs'), source, 'utf8')
    await run(
      target,
      'Inspect src/value.mjs in Ask mode. Read lines 2 through 4, inspect its metadata, extract its symbols, and search for double. Report what you find; do not modify files or run commands.',
      'ask',
      'accept',
    )
    expect(fs.readFileSync(path.join(target.workspace, 'src/value.mjs'), 'utf8')).toBe(source)
    const state = await agentSessionStateRepository.loadSessionState(target.identity.conversationId, target.workspace)
    for (const tool of ['read_file', 'get_file_info', 'extract_code_symbols', 'grep_search'])
      expect(
        state?.episodes.some((episode) => episode.tool === tool && episode.status === 'SUCCESS'),
        tool,
      ).toBe(true)
    expect(
      state?.chatMessages?.some((message) =>
        message.tool_calls?.some(
          (call) => call.function.name === 'read_file' && call.function.arguments.startLine === 2 && call.function.arguments.endLine === 4,
        ),
      ),
      'The partial read must actually request lines 2 through 4',
    ).toBe(true)
    expect(fs.readdirSync(target.workspace).filter((name) => name !== '.onlyrag')).toEqual(['src'])
    expect(fs.readdirSync(path.join(target.workspace, 'src'))).toEqual(['value.mjs'])
  })

  it('interviews for persistence and enriches the prompt with an explicit localStorage choice', async () => {
    const target = fixture('persistence-interview')
    const prompt = 'Add persistence to a React/Vite task app. First ask me whether to use localStorage or a server database. Do not choose a default.'
    target.save('input.json', { prompt, fixture: 'Interview only; no app implementation, persistence or reload qualification.' })
    const interview = await agentInterviewAppService.conductInterview(prompt, QWEN35_MODEL, campaign.settings, target.workspace, [], target.identity.runId)
    target.save('interview.json', interview)
    expect(interview.status, interview.error).toBe('clarification_required')
    expect(interview.questions).toHaveLength(1)
    const question = interview.questions[0]
    const choice = question.options.find((option) => /localStorage/i.test(option))
    expect(choice).toBeDefined()
    const answers: UserInterviewAnswer[] = [{ questionId: question.id, questionText: question.question, selectedOption: choice!, provenance: 'explicit' }]
    const enriched = agentInterviewAppService.enrichPromptWithAnswers(prompt, answers, interview.questions)
    target.save('answers.json', answers)
    target.save('enriched-prompt.json', { enriched })
    expect(enriched).toContain(choice!)
    expect(fs.readdirSync(target.workspace)).toEqual(['src'])
  })

  it('repairs a declared import fault in Guided with accepted consent and frozen tests', async () => {
    const target = fixture('guided-import-recovery')
    const frozen = {
      'package.json': JSON.stringify({
        name: 'import-fixture',
        private: true,
        type: 'module',
        scripts: { build: 'node --check src/main.mjs', test: 'node --test' },
      }),
      'src/value.mjs': 'export const value = 2\n',
      'src/main.test.mjs':
        "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\nimport { result } from './main.mjs'\ntest('result uses the named provider export', () => assert.equal(result, 2))\n",
    }
    for (const [name, content] of Object.entries(frozen)) fs.writeFileSync(path.join(target.workspace, name), content, 'utf8')
    fs.writeFileSync(path.join(target.workspace, 'src/main.mjs'), "import value from './value.mjs'\nexport const result = value\n", 'utf8')
    target.save('fixture.json', { declaredFault: 'Wrong default import in src/main.mjs; the provider exports named value.', frozen })
    const baseline = spawnSync(process.execPath, ['--test'], { cwd: target.workspace, windowsHide: true, encoding: 'utf8' })
    target.save('baseline.json', { status: baseline.status, stdout: baseline.stdout, stderr: baseline.stderr, error: baseline.error?.message })
    expect(baseline.error).toBeUndefined()
    expect(baseline.status).toBe(1)
    expect(`${baseline.stdout}\n${baseline.stderr}`).toContain('does not provide an export named')
    const prompt =
      'Run npm test first. Fix only the wrong import in src/main.mjs. Do not edit the provider, package.json or tests. Run npm test and npm run build again; finish only when both pass.'
    expect(
      await agentSessionStateRepository.seedPlanMilestones(
        target.identity.conversationId,
        target.workspace,
        [{ id: 'import-fix', title: 'Fix src/main.mjs', filePaths: ['src/main.mjs'], status: 'pending', verificationCommand: 'npm test' }],
        prompt,
        target.identity.planRevisionId,
      ),
    ).toBe(true)
    const result = await run(target, prompt, 'guided', 'accept')
    expect(result.success, result.summary).toBe(true)
    expect(result.completionStatus).toBe('verified')
    const approvalEvents = JSON.parse(fs.readFileSync(path.join(target.root, 'events.json'), 'utf8')) as Array<{ channel: string }>
    expect(
      approvalEvents.some((event) => event.channel === 'agent:approval-request'),
      'Guided acceptance must reach a real consent request',
    ).toBe(true)
    for (const command of [['--test'], ['--check', 'src/main.mjs']]) {
      const output = execFileSync(process.execPath, command, { cwd: target.workspace, windowsHide: true, encoding: 'utf8' })
      target.save(command[0] === '--test' ? 'independent-test.json' : 'independent-build.json', {
        command: [process.execPath, ...command],
        passed: true,
        output,
      })
    }
    for (const [name, content] of Object.entries(frozen)) expect(fs.readFileSync(path.join(target.workspace, name), 'utf8'), name).toBe(content)
  })

  it('rejects a Guided write and stops its owned run without changing the fixture', async () => {
    const target = fixture('guided-rejection-stop')
    fs.writeFileSync(path.join(target.workspace, 'note.txt'), 'before\n', 'utf8')
    const result = await run(target, 'Set note.txt to the literal text "after" followed by a newline. Use a file-edit tool.', 'guided', 'deny-and-cancel')
    const events = JSON.parse(fs.readFileSync(path.join(target.root, 'events.json'), 'utf8')) as Array<{ channel: string }>
    expect(events.some((event) => event.channel === 'agent:approval-request')).toBe(true)
    expect(fs.readFileSync(path.join(target.workspace, 'note.txt'), 'utf8')).toBe('before\n')
    expect(result.completionStatus).toBe('cancelled')
  })

  it('requires Git commit consent in Auto and leaves the isolated repository unborn', async () => {
    const target = fixture('git-commit-rejection')
    fs.writeFileSync(path.join(target.workspace, 'note.txt'), 'before\n', 'utf8')
    execFileSync('git', ['init'], { cwd: target.workspace, windowsHide: true, stdio: 'pipe' })
    execFileSync('git', ['add', '--', 'note.txt'], { cwd: target.workspace, windowsHide: true, stdio: 'pipe' })
    const before = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: target.workspace, windowsHide: true })
    expect(before.error).toBeUndefined()
    expect(before.status).toBe(128)
    await run(
      target,
      'Set only note.txt to the literal text "after" followed by a newline. Use git_status and git_diff, then call git_commit with commitMessage "Fixture change". The application will request separate approval before commit execution.',
      'auto',
      'deny-and-cancel',
      'git_commit',
    )
    const events = JSON.parse(fs.readFileSync(path.join(target.root, 'events.json'), 'utf8')) as Array<{ channel: string; payload: { type?: string } }>
    expect(events.some((event) => event.channel === 'agent:approval-request' && event.payload.type === 'git_commit')).toBe(true)
    const after = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: target.workspace, windowsHide: true })
    expect(after.error).toBeUndefined()
    expect(after.status).toBe(128)
  })

  it('creates, edits, copies, moves, deletes and rolls back isolated files with frozen verification', async () => {
    const target = fixture('filesystem-rollback')
    const frozen = {
      'seed.txt': 'before: isolated source content\n',
      'package.json': JSON.stringify({ name: 'filesystem-fixture', private: true, type: 'module', scripts: { test: 'node --test' } }),
      'src/filesystem.test.mjs':
        "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\nimport { readFileSync, existsSync } from 'node:fs'\ntest('copy, move, edit and delete rollback preserve prior work', () => {\n  assert.equal(readFileSync('seed.txt', 'utf8'), 'before: isolated source content\\n')\n  assert.equal(readFileSync('scratch/generated.txt', 'utf8'), 'generated: isolated file content\\n')\n  assert.equal(readFileSync('work/moved.txt', 'utf8'), 'after: isolated source content\\n')\n  assert.equal(existsSync('work/copy.txt'), false)\n})\n",
    }
    for (const [name, content] of Object.entries(frozen)) fs.writeFileSync(path.join(target.workspace, name), content, 'utf8')
    target.save('fixture.json', { scope: 'Declared isolated filesystem fixture; tests and seed are frozen, not an application scaffold.', frozen })
    const baseline = spawnSync(process.execPath, ['--test'], { cwd: target.workspace, windowsHide: true, encoding: 'utf8' })
    target.save('baseline.json', { status: baseline.status, stdout: baseline.stdout, stderr: baseline.stderr, error: baseline.error?.message })
    expect(baseline.error).toBeUndefined()
    expect(baseline.status).toBe(1)
    const prompt = `Use the native filesystem tools in this isolated fixture; do not implement these operations as shell commands.
Read seed.txt completely and list the workspace recursively.
Create work and scratch directories with create_directory. Write scratch/generated.txt as "generated: isolated file content" followed by a newline with write_file.
Use copy_file to copy seed.txt to work/copy.txt, then move_file to move it to work/moved.txt.
Read work/moved.txt, then use replace_file_content to change "before" to "after".
Use delete_file on work/moved.txt, then immediately rollback_last_step to undo only that deletion. Keep the earlier edit and created file.
Do not change seed.txt, package.json or src/filesystem.test.mjs. Run npm test and finish only when it passes.`
    expect(
      await agentSessionStateRepository.seedPlanMilestones(
        target.identity.conversationId,
        target.workspace,
        [
          {
            id: 'filesystem-operations',
            title: 'Perform and verify isolated filesystem operations',
            filePaths: ['work/moved.txt', 'scratch/generated.txt'],
            status: 'pending',
            verificationCommand: 'npm test',
          },
        ],
        prompt,
        target.identity.planRevisionId,
      ),
    ).toBe(true)
    const result = await run(target, prompt, 'auto', 'accept')
    expect(result.success, result.summary).toBe(true)
    expect(result.completionStatus).toBe('verified')
    const state = await agentSessionStateRepository.loadSessionState(target.identity.conversationId, target.workspace)
    for (const tool of [
      'read_file',
      'list_files_recursive',
      'create_directory',
      'write_file',
      'copy_file',
      'move_file',
      'replace_file_content',
      'delete_file',
      'rollback_last_step',
    ]) {
      expect(
        state?.episodes.some((episode) => episode.tool === tool && episode.status === 'SUCCESS'),
        tool,
      ).toBe(true)
    }
    const output = execFileSync(process.execPath, ['--test'], { cwd: target.workspace, windowsHide: true, encoding: 'utf8' })
    target.save('independent-test.json', { command: [process.execPath, '--test'], passed: true, output })
    for (const [name, content] of Object.entries(frozen)) expect(fs.readFileSync(path.join(target.workspace, name), 'utf8'), name).toBe(content)
    expect(fs.readdirSync(path.join(target.workspace, 'scratch'))).toEqual(['generated.txt'])
    expect(fs.readdirSync(path.join(target.workspace, 'work'))).toEqual(['moved.txt'])
  })

  it('rejects a stale file proposal and preserves a declared concurrent edit during recovery', async () => {
    const target = fixture('concurrent-edit-recovery')
    const file = path.join(target.workspace, 'src/value.mjs')
    const original = 'export const value = 2\n// Original fixture note.\n'
    const concurrent = 'export const value = 2\n// Concurrent collaborator note: keep this line.\n'
    const frozen = {
      'package.json': JSON.stringify({ name: 'concurrent-fixture', private: true, type: 'module', scripts: { test: 'node --test' } }),
      'src/value.test.mjs':
        "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\nimport { readFileSync } from 'node:fs'\nimport { value } from './value.mjs'\ntest('updated value preserves the collaborator line', () => {\n  assert.equal(value, 3)\n  assert.ok(readFileSync('src/value.mjs', 'utf8').includes('// Concurrent collaborator note: keep this line.'))\n})\n",
    }
    fs.writeFileSync(file, original, 'utf8')
    for (const [name, content] of Object.entries(frozen)) fs.writeFileSync(path.join(target.workspace, name), content, 'utf8')
    target.save('fixture.json', {
      scope: 'Declared external edit injected once during native Guided approval; no real collaborator or user file is modified.',
      original,
      concurrent,
      frozen,
    })
    const baseline = spawnSync(process.execPath, ['--test'], { cwd: target.workspace, windowsHide: true, encoding: 'utf8' })
    target.save('baseline.json', { status: baseline.status, stdout: baseline.stdout, stderr: baseline.stderr, error: baseline.error?.message })
    expect(baseline.error).toBeUndefined()
    expect(baseline.status).toBe(1)
    const prompt = `Read src/value.mjs completely.
Change only the exported value from 2 to 3 with a native file-edit tool. Preserve every other current line.
A concurrent edit may arrive during approval. On a version conflict, reread and preserve the concurrent edit before retrying.
Verify with the native run_tests tool, command "npm test". Do not use run_command or update_plan.
Do not edit package.json or src/value.test.mjs. Finish only after the test passes.`
    expect(
      await agentSessionStateRepository.seedPlanMilestones(
        target.identity.conversationId,
        target.workspace,
        [
          {
            id: 'concurrent-fix',
            title: 'Update src/value.mjs without losing concurrent content',
            filePaths: ['src/value.mjs'],
            status: 'pending',
            verificationCommand: 'npm test',
          },
        ],
        prompt,
        target.identity.planRevisionId,
      ),
    ).toBe(true)
    let injected = false
    const result = await run(target, prompt, 'guided', 'accept', undefined, (request) => {
      if (injected || !['write_file', 'replace_chunk', 'multi_replace'].includes(request.type) || !request.target.replace(/\\/g, '/').endsWith('src/value.mjs'))
        return
      expect(fs.readFileSync(file, 'utf8')).toBe(original)
      fs.writeFileSync(file, concurrent, 'utf8')
      injected = true
      target.save('injected-edit.json', { approval: request, before: original, after: concurrent, unchangedBeforeConsent: true })
    })
    expect(injected, 'The concurrent fault must occur during a real native approval request').toBe(true)
    expect(result.success, result.summary).toBe(true)
    expect(result.completionStatus).toBe('verified')
    const state = await agentSessionStateRepository.loadSessionState(target.identity.conversationId, target.workspace)
    expect(state?.episodes.some((episode) => episode.tool === 'run_tests' && episode.status === 'SUCCESS')).toBe(true)
    expect(
      state?.episodes.some((episode) => episode.tool === 'update_plan'),
      'run_tests must establish proof without a separate milestone update',
    ).toBe(false)
    expect(
      state?.episodes.some(
        (episode) => ['write_file', 'replace_file_content', 'multi_replace_file_content'].includes(episode.tool) && episode.status === 'FAILURE',
      ),
      'A stale write must actually be rejected',
    ).toBe(true)
    const events = JSON.parse(fs.readFileSync(path.join(target.root, 'events.json'), 'utf8')) as Array<{
      channel: string
      payload: { localized?: { message?: { key?: string } } }
    }>
    expect(events.some((event) => event.channel === 'agent:log' && event.payload.localized?.message?.key === 'toolEditStaleVersion')).toBe(true)
    expect(state?.episodes.filter((episode) => episode.tool === 'read_file' && episode.status === 'SUCCESS').length).toBeGreaterThanOrEqual(2)
    expect(fs.readFileSync(file, 'utf8')).toBe(concurrent.replace('value = 2', 'value = 3'))
    const output = execFileSync(process.execPath, ['--test'], { cwd: target.workspace, windowsHide: true, encoding: 'utf8' })
    target.save('independent-test.json', { command: [process.execPath, '--test'], passed: true, output })
    for (const [name, content] of Object.entries(frozen)) expect(fs.readFileSync(path.join(target.workspace, name), 'utf8'), name).toBe(content)
  })

  it('continues with read-only recovery after refused Guided consent without cancellation', async () => {
    const target = fixture('guided-denial-recovery')
    const original = 'original: unchanged isolated fixture\n'
    fs.writeFileSync(path.join(target.workspace, 'note.txt'), original, 'utf8')
    target.save('fixture.json', { scope: 'Declared Guided denial with natural read-only fallback; the harness does not cancel or modify this file.' })
    const result = await run(
      target,
      `Follow these native-tool steps in order:
1. read_file on note.txt.
2. write_file on note.txt with "after: requested fixture change" followed by a newline. The application handles approval.
3. If approval is refused, your next tool must be read_file on note.txt. Do not retry the edit or mutate anything else.
4. Only after that fresh read, call finish to report the unchanged contents. Do not run shell commands.`,
      'guided',
      'deny-and-continue',
    )
    const events = JSON.parse(fs.readFileSync(path.join(target.root, 'events.json'), 'utf8')) as Array<{ channel: string }>
    expect(events.filter((event) => event.channel === 'agent:approval-request')).toHaveLength(1)
    const state = await agentSessionStateRepository.loadSessionState(target.identity.conversationId, target.workspace)
    const denied = state?.episodes.find((episode) => episode.status === 'BLOCKED' && episode.summary === 'User denied contextual approval')
    expect(denied, 'Native contextual approval must be refused').toBeDefined()
    expect(state?.episodes.some((episode) => episode.tool === 'read_file' && episode.status === 'SUCCESS' && episode.step > denied!.step)).toBe(true)
    expect(state?.chatMessages?.some((message) => message.tool_calls?.some((call) => call.function.name === 'finish'))).toBe(true)
    expect(result.completionStatus).toBe('unverifiable')
    expect(result.evidence?.cancellationStatus).toBe('not_cancelled')
    expect(result.evidence?.changedFiles).toEqual([])
    expect(result.summary).toContain(original.trim())
    expect(fs.readFileSync(path.join(target.workspace, 'note.txt'), 'utf8')).toBe(original)
    expect(fs.readdirSync(target.workspace).filter((name) => name !== '.onlyrag')).toEqual(['note.txt', 'src'])
    expect(fs.readdirSync(path.join(target.workspace, 'src'))).toEqual([])
  })
})
