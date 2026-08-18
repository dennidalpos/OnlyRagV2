import type { HardwareProfileTier } from './hardwareProfileTiers'

/**
 * Static model catalog entry, independent of any runtime hardware detection.
 * `recommendedForProfiles` replaces the old inline `isRecommended: profileTier === 'x'`
 * conditionals — the catalog itself no longer needs to know about `profileTier` at
 * all, so each tier below is plain data instead of a function body (see AGT6:
 * analyzeHardwareAndRecommend in hardwareRecommendationEngine.ts used to embed all
 * of this directly, ~700 lines in a single function).
 */
export interface RawModelCatalogEntry {
  modelName: string
  displayName: string
  family: string
  sizeBytesApprox: string
  description: string
  recommendedForProfiles: HardwareProfileTier[]
}

// 🟢 Fast Tier Recommendations (Lightweight models: 1B - 3B)
export const FAST_TIER_CATALOG: RawModelCatalogEntry[] = [
  {
    modelName: 'qwen2.5-coder:1.5b',
    displayName: 'Qwen 2.5 Coder (1.5B)',
    family: 'qwen-coder',
    sizeBytesApprox: '1.1 GB',
    description: 'Ultra-fast code completion with minimal memory footprint & rapid token response',
    recommendedForProfiles: ['legacy', 'entry', 'midrange'],
  },
  {
    modelName: 'qwen2.5-coder:1.5b-instruct-q8_0',
    displayName: 'Qwen 2.5 Coder (1.5B Q8_0)',
    family: 'qwen-coder',
    sizeBytesApprox: '1.6 GB',
    description: 'High-precision 8-bit quantized fast coding model',
    recommendedForProfiles: [],
  },
  {
    modelName: 'qwen2.5-coder:3b',
    displayName: 'Qwen 2.5 Coder (3B)',
    family: 'qwen-coder',
    sizeBytesApprox: '1.9 GB',
    description: 'Compact high-accuracy code assistant for rapid editing & small refactors',
    recommendedForProfiles: ['highend', 'extreme'],
  },
  {
    modelName: 'qwen2.5-coder:3b-instruct-q4_k_m',
    displayName: 'Qwen 2.5 Coder (3B Q4_K_M)',
    family: 'qwen-coder',
    sizeBytesApprox: '1.8 GB',
    description: 'Quantized compact code assistant for fast edits',
    recommendedForProfiles: [],
  },
  {
    modelName: 'qwen2.5-coder:0.5b',
    displayName: 'Qwen 2.5 Coder (0.5B)',
    family: 'qwen-coder',
    sizeBytesApprox: '400 MB',
    description: 'Ultra-compact micro model for background helper tasks & zero memory pressure',
    recommendedForProfiles: [],
  },
  {
    modelName: 'llama3.2:1b',
    displayName: 'Llama 3.2 (1B)',
    family: 'llama',
    sizeBytesApprox: '1.3 GB',
    description: 'Minimal footprint model for ultra low-spec hardware and background helpers',
    recommendedForProfiles: [],
  },
  {
    modelName: 'llama3.2:3b',
    displayName: 'Llama 3.2 (3B)',
    family: 'llama',
    sizeBytesApprox: '2.0 GB',
    description: 'Balanced lightweight model for quick lookups, doc inspection & rapid editing',
    recommendedForProfiles: [],
  },
  {
    modelName: 'qwen2.5:1.5b',
    displayName: 'Qwen 2.5 (1.5B)',
    family: 'qwen',
    sizeBytesApprox: '1.0 GB',
    description: 'Fast Alibaba lightweight instruction model for concise task routing',
    recommendedForProfiles: [],
  },
]

// 🔵 Standard Tier Recommendations (Balanced workhorse models: 3B - 14B)
export const STANDARD_TIER_CATALOG: RawModelCatalogEntry[] = [
  {
    modelName: 'qwen2.5-coder:7b',
    displayName: 'Qwen 2.5 Coder (7B)',
    family: 'qwen-coder',
    sizeBytesApprox: '4.7 GB',
    description: 'State-of-the-art coding workhorse with high JSON precision & tool calling support',
    recommendedForProfiles: ['midrange', 'highend'],
  },
  {
    modelName: 'qwen2.5-coder:7b-instruct-q4_k_m',
    displayName: 'Qwen 2.5 Coder (7B Q4_K_M)',
    family: 'qwen-coder',
    sizeBytesApprox: '4.4 GB',
    description: 'Quantized 7B coding workhorse offering optimal VRAM headroom on 8GB GPUs',
    recommendedForProfiles: [],
  },
  {
    modelName: 'qwen2.5-coder:7b-instruct-q5_k_m',
    displayName: 'Qwen 2.5 Coder (7B Q5_K_M)',
    family: 'qwen-coder',
    sizeBytesApprox: '5.1 GB',
    description: 'High-precision 5-bit quantized coding workhorse',
    recommendedForProfiles: [],
  },
  {
    modelName: 'qwen2.5-coder:3b',
    displayName: 'Qwen 2.5 Coder (3B)',
    family: 'qwen-coder',
    sizeBytesApprox: '1.9 GB',
    description: 'Balanced low-VRAM coding assistant preserving full headroom on 4-6GB GPUs or CPU',
    recommendedForProfiles: ['legacy', 'entry'],
  },
  {
    modelName: 'qwen2.5-coder:14b',
    displayName: 'Qwen 2.5 Coder (14B)',
    family: 'qwen-coder',
    sizeBytesApprox: '9.0 GB',
    description: 'Large-scale coding model for architectural refactoring and multi-file workflows',
    recommendedForProfiles: ['extreme'],
  },
  {
    modelName: 'qwen2.5-coder:14b-instruct-q4_k_m',
    displayName: 'Qwen 2.5 Coder (14B Q4_K_M)',
    family: 'qwen-coder',
    sizeBytesApprox: '8.9 GB',
    description: 'Quantized 14B coding model for high-end GPUs',
    recommendedForProfiles: [],
  },
  {
    modelName: 'deepseek-coder:6.7b',
    displayName: 'DeepSeek Coder (6.7B)',
    family: 'deepseek',
    sizeBytesApprox: '3.8 GB',
    description: 'DeepSeek specialized code generation model with low VRAM requirement',
    recommendedForProfiles: [],
  },
  {
    modelName: 'deepseek-coder:6.7b-instruct-q4_k_m',
    displayName: 'DeepSeek Coder (6.7B Q4_K_M)',
    family: 'deepseek',
    sizeBytesApprox: '3.8 GB',
    description: 'Quantized DeepSeek code model for reliable generation',
    recommendedForProfiles: [],
  },
  {
    modelName: 'deepseek-coder-v2:16b-lite-instruct-q4_k_m',
    displayName: 'DeepSeek Coder V2 Lite (16B Q4_K_M)',
    family: 'deepseek',
    sizeBytesApprox: '8.9 GB',
    description: 'MoE coding architecture with 236 programming languages support',
    recommendedForProfiles: [],
  },
  {
    modelName: 'codestral:22b-v0.1-q4_k_m',
    displayName: 'Mistral Codestral (22B Q4_K_M)',
    family: 'mistral',
    sizeBytesApprox: '13.0 GB',
    description: 'Mistral enterprise code intelligence model (32k context)',
    recommendedForProfiles: [],
  },
  {
    modelName: 'starcoder2:7b',
    displayName: 'StarCoder 2 (7B)',
    family: 'starcoder',
    sizeBytesApprox: '4.4 GB',
    description: 'BigCode open-access code generation assistant',
    recommendedForProfiles: [],
  },
  {
    modelName: 'codellama:7b-instruct-q4_k_m',
    displayName: 'Code Llama (7B Q4_K_M)',
    family: 'codellama',
    sizeBytesApprox: '4.0 GB',
    description: 'Meta Code Llama specialized Python & C++ model',
    recommendedForProfiles: [],
  },
  {
    modelName: 'llama3.2:3b',
    displayName: 'Llama 3.2 (3B)',
    family: 'llama',
    sizeBytesApprox: '2.0 GB',
    description: 'Balanced low-memory fallback model for CPU/Legacy systems',
    recommendedForProfiles: [],
  },
]

// 🟣 Deep Reasoning Tier Recommendations (Multi-step reasoning & architecture)
export const DEEP_REASONING_TIER_CATALOG: RawModelCatalogEntry[] = [
  {
    modelName: 'qwen2.5-coder:7b',
    displayName: 'Qwen 2.5 Coder (7B)',
    family: 'qwen-coder',
    sizeBytesApprox: '4.7 GB',
    description: 'High-capability coding assistant for deep logic, multi-step refactors & debugging',
    recommendedForProfiles: ['midrange'],
  },
  {
    modelName: 'deepseek-r1:7b',
    displayName: 'DeepSeek R1 Distill Qwen (7B)',
    family: 'deepseek-r1',
    sizeBytesApprox: '4.7 GB',
    description: 'Qwen 2.5-Coder/Math distilled reasoning model for deep algorithmic problem solving',
    recommendedForProfiles: [],
  },
  {
    modelName: 'deepseek-r1:7b-qwen-distill-q4_k_m',
    displayName: 'DeepSeek R1 Distill Qwen (7B Q4_K_M)',
    family: 'deepseek-r1',
    sizeBytesApprox: '4.4 GB',
    description: 'Quantized Qwen-distilled reasoning model with low VRAM footprint',
    recommendedForProfiles: [],
  },
  {
    modelName: 'qwen2.5-coder:14b',
    displayName: 'Qwen 2.5 Coder (14B)',
    family: 'qwen-coder',
    sizeBytesApprox: '9.0 GB',
    description: 'Large-scale code intelligence for multi-file architecture refactors',
    recommendedForProfiles: ['highend'],
  },
  {
    modelName: 'deepseek-r1:14b',
    displayName: 'DeepSeek R1 Distill Qwen (14B)',
    family: 'deepseek-r1',
    sizeBytesApprox: '9.2 GB',
    description: 'High-capacity 14B Qwen-distilled reasoning engine for complex system design',
    recommendedForProfiles: [],
  },
  {
    modelName: 'deepseek-r1:14b-qwen-distill-q4_k_m',
    displayName: 'DeepSeek R1 Distill Qwen (14B Q4_K_M)',
    family: 'deepseek-r1',
    sizeBytesApprox: '9.0 GB',
    description: 'Quantized 14B deep reasoning engine for 12GB+ GPUs',
    recommendedForProfiles: [],
  },
  {
    modelName: 'qwen2.5-coder:32b',
    displayName: 'Qwen 2.5 Coder (32B)',
    family: 'qwen-coder',
    sizeBytesApprox: '20.0 GB',
    description: 'Premier 32B coding model rivaling proprietary models on complex codebases',
    recommendedForProfiles: ['extreme'],
  },
  {
    modelName: 'deepseek-r1:32b',
    displayName: 'DeepSeek R1 Distill Qwen (32B)',
    family: 'deepseek-r1',
    sizeBytesApprox: '20.0 GB',
    description: 'Ultra-scale 32B reasoning model for exhaustive multi-file code synthesis',
    recommendedForProfiles: [],
  },
  {
    modelName: 'deepseek-coder-v2:16b-lite-instruct-q4_k_m',
    displayName: 'DeepSeek Coder V2 Lite (16B Q4_K_M)',
    family: 'deepseek',
    sizeBytesApprox: '8.9 GB',
    description: 'MoE code reasoning engine with 236 programming languages support',
    recommendedForProfiles: [],
  },
  {
    modelName: 'deepseek-coder:6.7b',
    displayName: 'DeepSeek Coder (6.7B)',
    family: 'deepseek',
    sizeBytesApprox: '3.8 GB',
    description: 'Specialized coding model for entry-level and legacy GPU hardware',
    recommendedForProfiles: ['legacy', 'entry'],
  },
  {
    modelName: 'qwen2.5-coder:3b',
    displayName: 'Qwen 2.5 Coder (3B)',
    family: 'qwen-coder',
    sizeBytesApprox: '1.9 GB',
    description: 'Compact code model for low-VRAM devices with rapid reasoning',
    recommendedForProfiles: [],
  },
  {
    modelName: 'deepseek-r1:8b',
    displayName: 'DeepSeek R1 Distill Llama (8B)',
    family: 'deepseek-r1',
    sizeBytesApprox: '4.9 GB',
    description: 'Llama 3.1-8B distilled reasoning model for 12GB+ GPUs',
    recommendedForProfiles: [],
  },
  {
    modelName: 'phi4:14b',
    displayName: 'Microsoft Phi-4 (14B)',
    family: 'phi',
    sizeBytesApprox: '9.1 GB',
    description: 'Microsoft state-of-the-art synthetic reasoning & algorithmic assistant',
    recommendedForProfiles: [],
  },
  {
    modelName: 'codestral:22b-v0.1-q4_k_m',
    displayName: 'Mistral Codestral (22B Q4_K_M)',
    family: 'mistral',
    sizeBytesApprox: '13.0 GB',
    description: 'High-capacity code intelligence engine for complex software design',
    recommendedForProfiles: [],
  },
]

// ⚡ Heavy Escalation Tier (14B+) — Auto-healing fallback for complex multi-file tasks
export const HEAVY_ESCALATION_TIER_CATALOG: RawModelCatalogEntry[] = [
  {
    modelName: 'qwen2.5-coder:14b',
    displayName: 'Qwen 2.5 Coder (14B)',
    family: 'qwen-coder',
    sizeBytesApprox: '9.0 GB',
    description: 'Large-scale coding intelligence for complex multi-file refactoring and architecture tasks (12GB+ VRAM)',
    recommendedForProfiles: ['highend'],
  },
  {
    modelName: 'qwen2.5-coder:14b-instruct-q4_k_m',
    displayName: 'Qwen 2.5 Coder (14B Q4_K_M)',
    family: 'qwen-coder',
    sizeBytesApprox: '8.9 GB',
    description: 'Quantized 14B heavy escalation model with reduced VRAM footprint on 12GB GPUs',
    recommendedForProfiles: [],
  },
  {
    modelName: 'deepseek-r1:14b',
    displayName: 'DeepSeek R1 Distill Qwen (14B)',
    family: 'deepseek-r1',
    sizeBytesApprox: '9.2 GB',
    description: 'High-capacity 14B Qwen-distilled chain-of-thought reasoning engine for escalated debugging',
    recommendedForProfiles: [],
  },
  {
    modelName: 'deepseek-r1:14b-qwen-distill-q4_k_m',
    displayName: 'DeepSeek R1 Distill Qwen (14B Q4_K_M)',
    family: 'deepseek-r1',
    sizeBytesApprox: '9.0 GB',
    description: 'Quantized heavy reasoning model for auto-healing tool loop escalation on 12GB GPUs',
    recommendedForProfiles: [],
  },
  {
    modelName: 'codestral:22b-v0.1-q4_k_m',
    displayName: 'Mistral Codestral (22B Q4_K_M)',
    family: 'mistral',
    sizeBytesApprox: '13.0 GB',
    description: 'Enterprise-grade Mistral code intelligence for exhaustive system-wide architecture refactors',
    recommendedForProfiles: ['extreme'],
  },
  {
    modelName: 'qwen2.5-coder:32b',
    displayName: 'Qwen 2.5 Coder (32B)',
    family: 'qwen-coder',
    sizeBytesApprox: '20.0 GB',
    description: 'Premier 32B coding model rivaling proprietary models — requires 24GB+ VRAM workstation',
    recommendedForProfiles: [],
  },
  {
    modelName: 'qwen2.5-coder:32b-instruct-q4_k_m',
    displayName: 'Qwen 2.5 Coder (32B Q4_K_M)',
    family: 'qwen-coder',
    sizeBytesApprox: '19.5 GB',
    description: 'Quantized 32B coding model for extreme workstations and multi-GPU setups',
    recommendedForProfiles: [],
  },
]

// 💬 General / RAG Chat Models
export const CHAT_TIER_CATALOG: RawModelCatalogEntry[] = [
  {
    modelName: 'llama3.2:3b',
    displayName: 'Llama 3.2 (3B)',
    family: 'llama',
    sizeBytesApprox: '2.0 GB',
    description: 'Fast responsive conversational assistant for low-spec, 8GB GPUs or CPU systems',
    recommendedForProfiles: ['legacy', 'entry', 'midrange'],
  },
  {
    modelName: 'llama3.1:8b',
    displayName: 'Llama 3.1 (8B)',
    family: 'llama',
    sizeBytesApprox: '4.9 GB',
    description: 'Meta 8B balanced conversational assistant for 12GB+ GPUs and multi-document RAG',
    recommendedForProfiles: ['highend', 'extreme'],
  },
  {
    modelName: 'qwen2.5:7b',
    displayName: 'Qwen 2.5 (7B)',
    family: 'qwen',
    sizeBytesApprox: '4.7 GB',
    description: 'High-intelligence multilingual conversational model with strong factual recall',
    recommendedForProfiles: [],
  },
  {
    modelName: 'mistral:7b',
    displayName: 'Mistral (7B)',
    family: 'mistral',
    sizeBytesApprox: '4.1 GB',
    description: 'High-speed instruction model for RAG and factual Q&A',
    recommendedForProfiles: [],
  },
  {
    modelName: 'gemma2:9b',
    displayName: 'Gemma 2 (9B)',
    family: 'gemma',
    sizeBytesApprox: '5.5 GB',
    description: 'Google Gemma 2 high-precision conversational assistant',
    recommendedForProfiles: [],
  },
]

// 🌐 Document Translation Models
export const TRANSLATION_TIER_CATALOG: RawModelCatalogEntry[] = [
  {
    modelName: 'qwen2.5:3b',
    displayName: 'Qwen 2.5 (3B)',
    family: 'qwen',
    sizeBytesApprox: '1.9 GB',
    description: 'High-efficiency multilingual translation preserving layout without VRAM pressure',
    recommendedForProfiles: ['midrange'],
  },
  {
    modelName: 'qwen2.5:1.5b',
    displayName: 'Qwen 2.5 (1.5B)',
    family: 'qwen',
    sizeBytesApprox: '1.0 GB',
    description: 'Lightweight multilingual translation engine for CPU & entry-level GPU systems',
    recommendedForProfiles: ['legacy', 'entry'],
  },
  {
    modelName: 'qwen2.5:7b',
    displayName: 'Qwen 2.5 (7B)',
    family: 'qwen',
    sizeBytesApprox: '4.7 GB',
    description: 'Premier multilingual translation engine for 12GB+ GPUs preserving format',
    recommendedForProfiles: ['highend'],
  },
  {
    modelName: 'aya-expanse:8b',
    displayName: 'Aya Expanse (8B)',
    family: 'cohere',
    sizeBytesApprox: '5.1 GB',
    description: 'Cohere highly-aligned multilingual translation and cross-lingual model',
    recommendedForProfiles: ['extreme'],
  },
  {
    modelName: 'gemma2:2b',
    displayName: 'Google Gemma 2 (2B)',
    family: 'gemma',
    sizeBytesApprox: '1.6 GB',
    description: 'Ultra-lightweight fast multilingual translation model for low-spec systems',
    recommendedForProfiles: [],
  },
  {
    modelName: 'gemma2:9b',
    displayName: 'Google Gemma 2 (9B)',
    family: 'gemma',
    sizeBytesApprox: '5.5 GB',
    description: 'High-fidelity multilingual translation model for complex documents',
    recommendedForProfiles: [],
  },
  {
    modelName: 'mistral:7b',
    displayName: 'Mistral (7B)',
    family: 'mistral',
    sizeBytesApprox: '4.1 GB',
    description: 'European high-speed instruction model for document translation',
    recommendedForProfiles: [],
  },
]

// 👁️ Vision Tier Recommendations
export const VISION_TIER_CATALOG: RawModelCatalogEntry[] = [
  {
    modelName: 'moondream:latest',
    displayName: 'Moondream 2 (1.8B)',
    family: 'moondream',
    sizeBytesApprox: '1.7 GB',
    description: 'Compact fast vision model with minimal footprint for CPU, 4GB and 8GB GPU hardware',
    recommendedForProfiles: ['legacy', 'entry', 'midrange'],
  },
  {
    modelName: 'llava:7b',
    displayName: 'LLaVA (7B)',
    family: 'llava',
    sizeBytesApprox: '4.5 GB',
    description: 'Standard vision-language assistant model for general image & OCR inspection on 12GB+ GPUs',
    recommendedForProfiles: ['highend'],
  },
  {
    modelName: 'llama3.2-vision:11b',
    displayName: 'Llama 3.2 Vision (11B)',
    family: 'llama-vision',
    sizeBytesApprox: '7.9 GB',
    description: 'Meta multimodal model for diagram, table & page layout OCR/inspection',
    recommendedForProfiles: ['extreme'],
  },
  {
    modelName: 'minicpm-v:8b',
    displayName: 'MiniCPM-V (8B)',
    family: 'minicpm',
    sizeBytesApprox: '5.5 GB',
    description: 'High-efficiency multimodal OCR & document layout vision model',
    recommendedForProfiles: [],
  },
]

// 🧠 Vector Embedding Tier Recommendations
export const EMBEDDING_TIER_CATALOG: RawModelCatalogEntry[] = [
  {
    modelName: 'nomic-embed-text:latest',
    displayName: 'Nomic Embed Text (768-dim)',
    family: 'nomic',
    sizeBytesApprox: '274 MB',
    description: 'Standard high-recall embedding model for LanceDB vector search',
    recommendedForProfiles: ['legacy', 'entry', 'midrange'],
  },
  {
    modelName: 'bge-m3:latest',
    displayName: 'BAAI BGE-M3 (Multilingual 1024d)',
    family: 'bge',
    sizeBytesApprox: '1.1 GB',
    description: 'Multilingual dense & sparse embedding model for enterprise search',
    recommendedForProfiles: ['highend', 'extreme'],
  },
  {
    modelName: 'snowflake-arctic-embed:latest',
    displayName: 'Snowflake Arctic Embed (1024d)',
    family: 'snowflake',
    sizeBytesApprox: '600 MB',
    description: 'High-density multi-lingual retrieval embedding model',
    recommendedForProfiles: [],
  },
  {
    modelName: 'mxbai-embed-large:latest',
    displayName: 'MixedBread mxbai-embed-large',
    family: 'mxbai',
    sizeBytesApprox: '670 MB',
    description: 'Large high-density vector embedding model',
    recommendedForProfiles: [],
  },
  {
    modelName: 'all-minilm:latest',
    displayName: 'All-MiniLM-L6-v2',
    family: 'minilm',
    sizeBytesApprox: '120 MB',
    description: 'Ultra-fast compact sentence embedding model for lightweight CPU systems',
    recommendedForProfiles: [],
  },
]

// 🏥 Medical & Healthcare Domain Models
export const MEDICAL_TIER_CATALOG: RawModelCatalogEntry[] = [
  {
    modelName: 'llama3.2:3b',
    displayName: 'Llama 3.2 (3B)',
    family: 'llama',
    sizeBytesApprox: '2.0 GB',
    description: 'Lightweight biomedical and clinical terminology assistant for 4GB-8GB GPUs',
    recommendedForProfiles: ['legacy', 'entry', 'midrange'],
  },
  {
    modelName: 'adrienbrault/biomistral-7b:Q4_K_M',
    displayName: 'BioMistral (7B Q4_K_M)',
    family: 'biomistral',
    sizeBytesApprox: '4.1 GB',
    description: 'Specialized biomedical QA, clinical pharmacology & PubMed evidence for 12GB+ GPUs',
    recommendedForProfiles: ['highend'],
  },
  {
    modelName: 'meditron:7b',
    displayName: 'Meditron (7B)',
    family: 'meditron',
    sizeBytesApprox: '4.3 GB',
    description: 'Clinical guidelines, PubMed evidence & medical Q&A assistant',
    recommendedForProfiles: [],
  },
  {
    modelName: 'meditron:70b',
    displayName: 'Meditron (70B)',
    family: 'meditron',
    sizeBytesApprox: '40.0 GB',
    description: 'Enterprise-grade clinical decision support and nosology consultation',
    recommendedForProfiles: ['extreme'],
  },
  {
    modelName: 'llama3.1:8b',
    displayName: 'Llama 3.1 (8B)',
    family: 'llama',
    sizeBytesApprox: '4.9 GB',
    description: 'Meta 8B balanced model with broad medical and clinical terminology support',
    recommendedForProfiles: [],
  },
]

// ⚖️ Legal & Compliance Domain Models
export const LEGAL_TIER_CATALOG: RawModelCatalogEntry[] = [
  {
    modelName: 'llama3.2:3b',
    displayName: 'Llama 3.2 (3B)',
    family: 'llama',
    sizeBytesApprox: '2.0 GB',
    description: 'Lightweight legal contract review & compliance for low-VRAM & 8GB systems',
    recommendedForProfiles: ['legacy', 'entry', 'midrange'],
  },
  {
    modelName: 'llama3.1:8b',
    displayName: 'Llama 3.1 (8B)',
    family: 'llama',
    sizeBytesApprox: '4.9 GB',
    description: 'Statutory compliance, legal drafting & regulatory entity extraction for 12GB+ GPUs',
    recommendedForProfiles: ['highend'],
  },
  {
    modelName: 'mistral:7b',
    displayName: 'Mistral (7B)',
    family: 'mistral',
    sizeBytesApprox: '4.1 GB',
    description: 'Specialized legal analysis, European jurisprudence & contract clause review',
    recommendedForProfiles: [],
  },
  {
    modelName: 'command-r:35b',
    displayName: 'Cohere Command R (35B)',
    family: 'cohere',
    sizeBytesApprox: '20.0 GB',
    description: 'Grounded RAG with strict citations, compliance policies & legal synthesis',
    recommendedForProfiles: ['extreme'],
  },
  {
    modelName: 'command-r-plus:104b',
    displayName: 'Cohere Command R+ (104B)',
    family: 'cohere',
    sizeBytesApprox: '60.0 GB',
    description: 'Enterprise legal corpus reasoning, high-precision compliance and contract risk',
    recommendedForProfiles: [],
  },
]
