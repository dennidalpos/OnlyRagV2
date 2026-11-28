/** Small, stable starter set. All other model choices come from the connected Ollama host. */
export interface HardwareWizardModelSuite {
  coding: string
  chat: string
  translation: string
  vision: string
  embedding: string
}

export const STARTER_MODEL_SUITE: Readonly<HardwareWizardModelSuite> = {
  coding: 'qwen2.5-coder:3b',
  chat: 'llama3.2:3b',
  translation: 'llama3.2:3b',
  vision: 'moondream:latest',
  embedding: 'nomic-embed-text:latest',
}

export function buildHardwareWizardModelSuite(): HardwareWizardModelSuite {
  return { ...STARTER_MODEL_SUITE }
}
