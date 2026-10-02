import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { WizardStepRecommendedModels } from './WizardStepRecommendedModels'

describe('wizard model choices', () => {
  it('offers only installed Ollama tags and reports a missing saved assignment separately', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () =>
      root.render(
        <WizardStepRecommendedModels
          downloadedModels={['local-model:latest', 'vision-model:latest']}
          getModelFit={() => ({ placement: 'gpu_possible', contextTokens: 16384, minimumGB: 2, maximumGB: 3, basis: 'metadata', uncertain: true })}
          selectedCoding="retired:1b"
          onChangeCoding={vi.fn()}
          selectedChat="local-model:latest"
          onChangeChat={vi.fn()}
          selectedTranslation="local-model:latest"
          onChangeTranslation={vi.fn()}
          selectedVision="vision-model:latest"
          onChangeVision={vi.fn()}
          selectedEmbedding="local-model:latest"
          onChangeEmbedding={vi.fn()}
          onChangeMedical={vi.fn()}
          onChangeLegal={vi.fn()}
        />,
      ),
    )

    const optionValues = [...container.querySelectorAll('option')].map((option) => option.value)
    expect(optionValues).toContain('local-model:latest')
    expect(optionValues).toContain('vision-model:latest')
    expect(optionValues).not.toContain('retired:1b')
    expect(container.querySelector('[role="status"]')?.textContent).toContain('retired:1b')
    expect(container.textContent).toContain('16384 ctx · 2.0–3.0 GiB')
    expect(container.textContent).toContain('cache')

    await act(async () => root.unmount())
    container.remove()
  })
})
