import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SkillEditorModal } from './SkillEditorModal'
import type { SkillDefinition, SkillSaveInput } from '../../../types'

const NL = String.fromCharCode(10)

const skill = {
  id: 'fixture',
  name: 'fixture',
  description: '  padded description  ',
  content: [' ', '# Body', '', '  trailing  ', '', ''].join(NL),
  filePath: 'C:\\skills\\fixture\\SKILL.md',
  isActive: true,
  isWorkspaceLocal: true,
  triggers: ['Mixed Case', 'comma,value', ['line', 'break'].join(NL), 'C:\\temp\\repo'],
  tags: ['"quoted"', 'a,b', 'false'],
  version: ' 1.0.0 ',
  author: 'Local ',
  originType: 'local_custom',
  isModified: false,
} as unknown as SkillDefinition

describe('SkillEditorModal lossless update', () => {
  let container: HTMLDivElement
  let root: Root
  const onSave = vi.fn<(input: SkillSaveInput) => Promise<void>>().mockResolvedValue(undefined)
  const onClose = vi.fn()

  beforeEach(async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    vi.clearAllMocks()
    await act(async () => root.render(<SkillEditorModal isOpen onClose={onClose} onSave={onSave} initialSkill={skill} isLoading={false} />))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  const submit = async () => {
    const form = document.querySelector('form') as HTMLFormElement
    await act(async () => form.requestSubmit())
  }

  const type = async (selector: string, value: string) => {
    const el = document.querySelector(selector) as HTMLTextAreaElement | HTMLInputElement
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    await act(async () => {
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it('saves an untouched skill with lists, metadata and body exactly as stored', async () => {
    await submit()
    expect(onSave).toHaveBeenCalledTimes(1)
    const payload = onSave.mock.calls[0][0]
    expect(payload.triggers).toEqual(skill.triggers)
    expect(payload.tags).toEqual(skill.tags)
    expect(payload.content).toBe(skill.content)
    expect(payload.description).toBe(skill.description)
    expect(payload.version).toBe(skill.version)
    expect(payload.author).toBe(skill.author)
  })

  it('lets an explicit edit replace a list one item per line without splitting on commas or changing case', async () => {
    await type('#skill-triggers-input', ['Keep, Me', ' Second Item ', '', 'Third'].join(NL))
    await submit()
    const payload = onSave.mock.calls[0][0]
    expect(payload.triggers).toEqual(['Keep, Me', 'Second Item', 'Third'])
    expect(payload.tags).toEqual(skill.tags)
    expect(payload.content).toBe(skill.content)
  })

  it('does not save on cancel', async () => {
    const cancel = [...document.querySelectorAll('button')].find(
      (b) => b.getAttribute('type') === 'button' && !b.getAttribute('aria-label'),
    ) as HTMLButtonElement
    await act(async () => cancel.click())
    expect(onClose).toHaveBeenCalled()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('keeps the form values after a save the hook reported as failed so it can be retried', async () => {
    // The hook reports failures itself and resolves, so the modal stays open with its edits.
    await type('#skill-content-textarea', skill.content + 'more')
    await submit()
    expect((document.querySelector('#skill-content-textarea') as HTMLTextAreaElement).value).toBe(skill.content + 'more')
    await submit()
    expect(onSave).toHaveBeenCalledTimes(2)
    expect(onSave.mock.calls[1][0].content).toBe(skill.content + 'more')
  })
})
