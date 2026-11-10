// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { RequestScopeReview } from './RequestScopeReview'
import type { RequestCoverageLedger } from '../../../shared/domain/agent/requestCoverageLedger'
const ledger: RequestCoverageLedger = {
  request: 'Export CSV and JSON.',
  obligations: [
    {
      id: 'r1',
      sourceLines: [1],
      requirement: 'Export CSV and JSON.',
      subject: 'exports',
      scope: 'local',
      targets: ['CSV', 'JSON'],
      closedInventory: true,
      conditions: [],
    },
  ],
}
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})
const button = (text: string) => [...container.querySelectorAll('button')].find((item) => item.textContent?.includes(text))!
it('shows original source and requires an explicit confirmation click', async () => {
  const confirm = vi.fn()
  await act(async () => root.render(<RequestScopeReview draft={ledger} onConfirm={confirm} />))
  expect(container.querySelector('blockquote')?.textContent).toBe(ledger.request)
  expect(confirm).not.toHaveBeenCalled()
  await act(async () => button('Conferma ambito').click())
  expect(confirm).toHaveBeenCalledWith(ledger)
})
it('splits obligations with stable distinct IDs and refuses deleting the last source obligation', async () => {
  const confirm = vi.fn()
  await act(async () => root.render(<RequestScopeReview draft={ledger} onConfirm={confirm} />))
  await act(async () => button('Separa obbligo').click())
  await act(async () => button('Conferma ambito').click())
  const confirmed = confirm.mock.calls[0][0] as RequestCoverageLedger
  expect(confirmed.obligations).toHaveLength(2)
  expect(new Set(confirmed.obligations.map((item) => item.id)).size).toBe(2)
  await act(async () => button('Elimina').click())
  await act(async () => button('Elimina').click())
  expect(button('Conferma ambito').disabled).toBe(true)
  expect(container.querySelector('[role="alert"]')).not.toBeNull()
})
it('preserves multiline edits instead of removing the newline being typed', async () => {
  const confirm = vi.fn()
  await act(async () => root.render(<RequestScopeReview draft={ledger} onConfirm={confirm} />))
  const targets = container.querySelectorAll('textarea')[1]
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(targets, 'CSV\nJSON\n')
    targets.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(targets.value).toBe('CSV\nJSON\n')
  expect(button('Conferma ambito').disabled).toBe(true)
})
