import { DiagnosticsData } from '../types'

export type HardwareProfileTier = 'legacy' | 'midrange' | 'highend'

export interface ModelRecommendation {
  modelName: string
  displayName: string
  family: string
  sizeBytesApprox: string
  description: string
  isRecommended: boolean
}

export interface HardwareRecommendations {
  profileTier: HardwareProfileTier
  profileName: string
  gpuSummary: string
  ramSummary: string
  fastTierModels: ModelRecommendation[]
  standardTierModels: ModelRecommendation[]
  deepReasoningTierModels: ModelRecommendation[]
  chatTierModels: ModelRecommendation[]
  translationTierModels: ModelRecommendation[]
  visionTierModels: ModelRecommendation[]
  embeddingTierModels: ModelRecommendation[]
}

export function analyzeHardwareAndRecommend(diagnostics: DiagnosticsData | null): HardwareRecommendations {
  const hasGpu = diagnostics?.gpu.hasNvidiaGpu || false
  const vramTotalMB = diagnostics?.gpu.vramTotalMB || 0
  const vramGB = Math.floor(vramTotalMB / 1024)
  const systemRamGB = Math.round(diagnostics?.memory.totalRAMGB || 8)

  let profileTier: HardwareProfileTier = 'midrange'
  let profileName = `Mid-Range Hardware (${vramGB > 0 ? `${vramGB}GB VRAM` : 'GPU'} / ${systemRamGB}GB RAM)`

  if (!hasGpu || vramGB < 4) {
    profileTier = 'legacy'
    profileName = `Legacy / CPU-Only Hardware (${vramGB}GB VRAM / ${systemRamGB}GB RAM)`
  } else if (vramGB >= 12) {
    profileTier = 'highend'
    profileName = `High-Performance Hardware (${vramGB}GB VRAM / ${systemRamGB}GB RAM)`
  }

  const gpuSummary = hasGpu
    ? `${diagnostics?.gpu.gpuName || 'NVIDIA GPU'} (${vramGB} GB VRAM)`
    : 'No Dedicated GPU Detected (CPU Execution)'
  const ramSummary = `${systemRamGB} GB System RAM`

  // 🟢 Fast Tier Recommendations (Lightweight models)
  const fastTierModels: ModelRecommendation[] = [
    {
      modelName: 'llama3.2:3b',
      displayName: 'Llama 3.2 (3B)',
      family: 'llama',
      sizeBytesApprox: '2.0 GB',
      description: 'Ultra-fast lightweight model for quick questions & simple lookups',
      isRecommended: profileTier !== 'legacy',
    },
    {
      modelName: 'llama3.2:1b',
      displayName: 'Llama 3.2 (1B)',
      family: 'llama',
      sizeBytesApprox: '1.3 GB',
      description: 'Minimal footprint model for low-spec hardware',
      isRecommended: profileTier === 'legacy',
    },
    {
      modelName: 'qwen2.5:1.5b',
      displayName: 'Qwen 2.5 (1.5B)',
      family: 'qwen',
      sizeBytesApprox: '1.0 GB',
      description: 'Fast Alibaba lightweight instruction model',
      isRecommended: false,
    },
    {
      modelName: 'qwen2.5-coder:1.5b',
      displayName: 'Qwen 2.5 Coder (1.5B)',
      family: 'qwen',
      sizeBytesApprox: '1.1 GB',
      description: 'Ultra-fast code completion & single file edits',
      isRecommended: false,
    },
  ]

  // 🔵 Standard Tier Recommendations (Balanced workhorse models)
  const standardTierModels: ModelRecommendation[] = [
    {
      modelName: 'qwen2.5-coder:7b',
      displayName: 'Qwen 2.5 Coder (7B)',
      family: 'qwen',
      sizeBytesApprox: '4.7 GB',
      description: 'State-of-the-art coding workhorse with high JSON precision',
      isRecommended: profileTier !== 'legacy',
    },
    {
      modelName: 'llama3.1:8b',
      displayName: 'Llama 3.1 (8B)',
      family: 'llama',
      sizeBytesApprox: '4.9 GB',
      description: 'Meta 8B balanced instruction & conversation model',
      isRecommended: profileTier === 'legacy',
    },
    {
      modelName: 'mistral:7b',
      displayName: 'Mistral (7B)',
      family: 'mistral',
      sizeBytesApprox: '4.1 GB',
      description: 'High-speed European LLM for text and documentation',
      isRecommended: false,
    },
    {
      modelName: 'deepseek-coder:6.7b',
      displayName: 'DeepSeek Coder (6.7B)',
      family: 'deepseek',
      sizeBytesApprox: '3.8 GB',
      description: 'DeepSeek specialized code generation model',
      isRecommended: false,
    },
  ]

  // 🟣 Deep Reasoning Tier Recommendations (Advanced multi-step reasoning models)
  const deepReasoningTierModels: ModelRecommendation[] = [
    {
      modelName: 'deepseek-r1:8b',
      displayName: 'DeepSeek R1 (8B)',
      family: 'deepseek',
      sizeBytesApprox: '4.9 GB',
      description: 'Advanced step-by-step reasoning model for complex debugging',
      isRecommended: profileTier === 'midrange',
    },
    {
      modelName: 'qwen2.5-coder:14b',
      displayName: 'Qwen 2.5 Coder (14B)',
      family: 'qwen',
      sizeBytesApprox: '9.0 GB',
      description: 'Large-scale coding model for architectural refactoring',
      isRecommended: profileTier === 'highend',
    },
    {
      modelName: 'deepseek-r1:14b',
      displayName: 'DeepSeek R1 (14B)',
      family: 'deepseek',
      sizeBytesApprox: '9.2 GB',
      description: 'High-capacity reasoning engine for deep technical analysis',
      isRecommended: false,
    },
    {
      modelName: 'deepseek-r1:1.5b',
      displayName: 'DeepSeek R1 (1.5B)',
      family: 'deepseek',
      sizeBytesApprox: '1.1 GB',
      description: 'Lightweight reasoning model for lower-spec hardware',
      isRecommended: profileTier === 'legacy',
    },
  ]

  // 💬 General / RAG Chat Models (Outside Coding Complexity Router)
  const chatTierModels: ModelRecommendation[] = [
    {
      modelName: 'llama3.1:8b',
      displayName: 'Llama 3.1 (8B)',
      family: 'llama',
      sizeBytesApprox: '4.9 GB',
      description: 'Meta 8B balanced conversational assistant for multi-document RAG & Q&A',
      isRecommended: profileTier !== 'legacy',
    },
    {
      modelName: 'llama3.2:3b',
      displayName: 'Llama 3.2 (3B)',
      family: 'llama',
      sizeBytesApprox: '2.0 GB',
      description: 'Fast responsive conversational assistant for low-spec or CPU systems',
      isRecommended: profileTier === 'legacy',
    },
    {
      modelName: 'qwen2.5:7b',
      displayName: 'Qwen 2.5 (7B)',
      family: 'qwen',
      sizeBytesApprox: '4.7 GB',
      description: 'High-intelligence multilingual conversational model with strong factual recall',
      isRecommended: false,
    },
    {
      modelName: 'mistral:7b',
      displayName: 'Mistral (7B)',
      family: 'mistral',
      sizeBytesApprox: '4.1 GB',
      description: 'High-speed instruction model for RAG and factual Q&A',
      isRecommended: false,
    },
    {
      modelName: 'gemma2:9b',
      displayName: 'Gemma 2 (9B)',
      family: 'gemma',
      sizeBytesApprox: '5.5 GB',
      description: 'Google Gemma 2 high-precision conversational assistant',
      isRecommended: false,
    },
  ]

  // 🌐 Document Translation Models (Outside Coding Complexity Router)
  const translationTierModels: ModelRecommendation[] = [
    {
      modelName: 'qwen2.5:7b',
      displayName: 'Qwen 2.5 (7B)',
      family: 'qwen',
      sizeBytesApprox: '4.7 GB',
      description: 'Premier multilingual translation engine preserving layout and markdown format',
      isRecommended: profileTier !== 'legacy',
    },
    {
      modelName: 'qwen2.5:1.5b',
      displayName: 'Qwen 2.5 (1.5B)',
      family: 'qwen',
      sizeBytesApprox: '1.0 GB',
      description: 'Lightweight multilingual translation engine for CPU/Legacy systems',
      isRecommended: profileTier === 'legacy',
    },
    {
      modelName: 'llama3.1:8b',
      displayName: 'Llama 3.1 (8B)',
      family: 'llama',
      sizeBytesApprox: '4.9 GB',
      description: 'Meta 8B multilingual model for cross-lingual document translation',
      isRecommended: false,
    },
    {
      modelName: 'mistral:7b',
      displayName: 'Mistral (7B)',
      family: 'mistral',
      sizeBytesApprox: '4.1 GB',
      description: 'Fast European multilingual translation model',
      isRecommended: false,
    },
  ]

  // 👁️ Vision Tier Recommendations
  const visionTierModels: ModelRecommendation[] = [
    {
      modelName: 'qwen2.5vl:3b',
      displayName: 'Qwen 2.5 VL (3B)',
      family: 'qwen',
      sizeBytesApprox: '3.2 GB',
      description: 'Ultra-fast high-accuracy vision language model for OCR and layout inspection',
      isRecommended: profileTier === 'midrange' || profileTier === 'legacy',
    },
    {
      modelName: 'llama3.2-vision:11b',
      displayName: 'Llama 3.2 Vision (11B)',
      family: 'llama',
      sizeBytesApprox: '7.9 GB',
      description: 'Meta multimodal model for diagram, table & page layout OCR/inspection',
      isRecommended: profileTier === 'highend',
    },
    {
      modelName: 'minicpm-v:8b',
      displayName: 'MiniCPM-V (8B)',
      family: 'minicpm',
      sizeBytesApprox: '5.5 GB',
      description: 'High-efficiency multimodal OCR & document layout vision model',
      isRecommended: false,
    },
    {
      modelName: 'moondream:latest',
      displayName: 'Moondream 2 (1.8B)',
      family: 'moondream',
      sizeBytesApprox: '1.7 GB',
      description: 'Compact fast vision model for lightweight/CPU hardware',
      isRecommended: false,
    },
    {
      modelName: 'llava:7b',
      displayName: 'LLaVA (7B)',
      family: 'llava',
      sizeBytesApprox: '4.5 GB',
      description: 'Standard vision-language assistant model for general image inspection',
      isRecommended: false,
    },
  ]

  // 🧠 Vector Embedding Tier Recommendations
  const embeddingTierModels: ModelRecommendation[] = [
    {
      modelName: 'nomic-embed-text',
      displayName: 'Nomic Embed Text (768-dim)',
      family: 'nomic',
      sizeBytesApprox: '274 MB',
      description: 'Standard high-recall embedding model for LanceDB vector search',
      isRecommended: profileTier !== 'highend',
    },
    {
      modelName: 'mxbai-embed-large',
      displayName: 'MixedBread mxbai-embed-large',
      family: 'mxbai',
      sizeBytesApprox: '670 MB',
      description: 'Large high-density vector embedding model',
      isRecommended: profileTier === 'highend',
    },
    {
      modelName: 'bge-m3:latest',
      displayName: 'BAAI BGE-M3 (Multilingual 1024d)',
      family: 'bge',
      sizeBytesApprox: '1.1 GB',
      description: 'Multilingual dense & sparse embedding model',
      isRecommended: false,
    },
  ]

  return {
    profileTier,
    profileName,
    gpuSummary,
    ramSummary,
    fastTierModels,
    standardTierModels,
    deepReasoningTierModels,
    chatTierModels,
    translationTierModels,
    visionTierModels,
    embeddingTierModels,
  }
}
