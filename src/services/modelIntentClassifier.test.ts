import { describe, it, expect } from 'vitest'
import {
  isVisionModel,
  isEmbeddingModel,
  isCodingModel,
  isTranslationModel,
  isChatModel,
  isMedicalModel,
  isLegalModel,
  isModelForIntent,
  getModelIntents,
  filterModelsByIntent,
  normalizeModelNameForIntent,
} from './modelIntentClassifier'

describe('modelIntentClassifier Unit Tests', () => {
  describe('normalizeModelNameForIntent', () => {
    it('should normalize namespaces and tags cleanly', () => {
      expect(normalizeModelNameForIntent('adrienbrault/biomistral-7b:Q4_K_M')).toEqual({
        normalized: 'adrienbrault/biomistral-7b:q4_k_m',
        baseName: 'biomistral-7b',
        tag: 'q4_k_m',
      })
      expect(normalizeModelNameForIntent('llama3.2-vision:11b')).toEqual({
        normalized: 'llama3.2-vision:11b',
        baseName: 'llama3.2-vision',
        tag: '11b',
      })
      expect(normalizeModelNameForIntent('')).toEqual({
        normalized: '',
        baseName: '',
        tag: '',
      })
    })
  })

  describe('isVisionModel', () => {
    it('should correctly classify Vision / Multimodal models', () => {
      expect(isVisionModel('llama3.2-vision:11b')).toBe(true)
      expect(isVisionModel('llama3.2-vision:latest')).toBe(true)
      expect(isVisionModel('minicpm-v:8b')).toBe(true)
      expect(isVisionModel('llava:7b')).toBe(true)
      expect(isVisionModel('llava:13b')).toBe(true)
      expect(isVisionModel('moondream:latest')).toBe(true)
      expect(isVisionModel('qwen2.5vl:3b')).toBe(true)
      expect(isVisionModel('qwen2.5vl:7b')).toBe(true)
      expect(isVisionModel('qwen2-vl:7b')).toBe(true)
      expect(isVisionModel('bakllava:latest')).toBe(true)
      expect(isVisionModel('gemma3:4b')).toBe(true)
      expect(isVisionModel('gemma3:12b')).toBe(true)
    })

    it('should strictly reject text-only models and embedding models', () => {
      expect(isVisionModel('qwen2.5-coder:7b')).toBe(false)
      expect(isVisionModel('llama3.1:8b')).toBe(false)
      expect(isVisionModel('llama3.2:3b')).toBe(false) // 3b is text-only, llama3.2-vision is vision
      expect(isVisionModel('nomic-embed-text:latest')).toBe(false)
      expect(isVisionModel('bge-m3:latest')).toBe(false)
      expect(isVisionModel('mistral:7b')).toBe(false)
      expect(isVisionModel('deepseek-r1:8b')).toBe(false)
      expect(isVisionModel('gemma3:1b')).toBe(false) // 1b is text-only
    })
  })

  describe('isEmbeddingModel', () => {
    it('should classify embedding models correctly', () => {
      expect(isEmbeddingModel('nomic-embed-text:latest')).toBe(true)
      expect(isEmbeddingModel('nomic-embed-text')).toBe(true)
      expect(isEmbeddingModel('bge-m3:latest')).toBe(true)
      expect(isEmbeddingModel('all-minilm:latest')).toBe(true)
      expect(isEmbeddingModel('mxbai-embed-large:latest')).toBe(true)
      expect(isEmbeddingModel('snowflake-arctic-embed:latest')).toBe(true)
      expect(isEmbeddingModel('embeddinggemma:300m')).toBe(true)
      expect(isEmbeddingModel('granite-embedding:278m')).toBe(true)
    })

    it('should reject generative LLMs', () => {
      expect(isEmbeddingModel('qwen2.5-coder:7b')).toBe(false)
      expect(isEmbeddingModel('llama3.2-vision:11b')).toBe(false)
      expect(isEmbeddingModel('llama3.1:8b')).toBe(false)
      expect(isEmbeddingModel('mistral:7b')).toBe(false)
    })
  })

  describe('isCodingModel', () => {
    it('should classify coding specialized and strong reasoning models', () => {
      expect(isCodingModel('qwen2.5-coder:7b')).toBe(true)
      expect(isCodingModel('qwen2.5-coder:1.5b')).toBe(true)
      expect(isCodingModel('codestral:22b')).toBe(true)
      expect(isCodingModel('deepseek-coder:6.7b')).toBe(true)
      expect(isCodingModel('deepseek-r1:8b')).toBe(true)
      expect(isCodingModel('llama3.1:8b')).toBe(true)
      expect(isCodingModel('qwen3:8b')).toBe(true)
    })

    it('should reject embedding and vision models', () => {
      expect(isCodingModel('nomic-embed-text:latest')).toBe(false)
      expect(isCodingModel('bge-m3')).toBe(false)
      expect(isCodingModel('llama3.2-vision:11b')).toBe(false)
      expect(isCodingModel('moondream:latest')).toBe(false)
      expect(isCodingModel('llava:7b')).toBe(false)
    })
  })

  describe('isTranslationModel', () => {
    it('should classify translation models and multilingual LLMs', () => {
      expect(isTranslationModel('aya-expanse:8b')).toBe(true)
      expect(isTranslationModel('aya:35b')).toBe(true)
      expect(isTranslationModel('qwen2.5:7b')).toBe(true)
      expect(isTranslationModel('llama3.1:8b')).toBe(true)
      expect(isTranslationModel('gemma2:9b')).toBe(true)
      expect(isTranslationModel('mistral:7b')).toBe(true)
    })

    it('should reject embedding and vision models', () => {
      expect(isTranslationModel('nomic-embed-text')).toBe(false)
      expect(isTranslationModel('moondream:latest')).toBe(false)
    })
  })

  describe('isMedicalModel & isLegalModel', () => {
    it('should classify specialized and medical catalog models', () => {
      expect(isMedicalModel('adrienbrault/biomistral-7b:Q4_K_M')).toBe(true)
      expect(isMedicalModel('meditron:7b')).toBe(true)
      expect(isMedicalModel('meditron:70b')).toBe(true)
      expect(isMedicalModel('llama3.1:8b')).toBe(true)
      expect(isMedicalModel('nomic-embed-text')).toBe(false)
    })

    it('should classify legal models', () => {
      expect(isLegalModel('command-r:35b')).toBe(true)
      expect(isLegalModel('command-r-plus:104b')).toBe(true)
      expect(isLegalModel('mistral:7b')).toBe(true)
      expect(isLegalModel('llama3.1:8b')).toBe(true)
      expect(isLegalModel('moondream:latest')).toBe(false)
    })
  })

  describe('isChatModel & isModelForIntent', () => {
    it('should classify conversational chat models correctly', () => {
      expect(isChatModel('llama3.1:8b')).toBe(true)
      expect(isChatModel('mistral:7b')).toBe(true)
      expect(isChatModel('qwen2.5:7b')).toBe(true)
      expect(isChatModel('deepseek-r1:8b')).toBe(true)
      expect(isChatModel('nomic-embed-text')).toBe(false)
      expect(isChatModel('moondream:latest')).toBe(false)
    })

    it('should evaluate isModelForIntent for all intents', () => {
      expect(isModelForIntent('llama3.2-vision:11b', 'vision')).toBe(true)
      expect(isModelForIntent('llama3.2-vision:11b', 'coding')).toBe(false)
      expect(isModelForIntent('nomic-embed-text', 'embedding')).toBe(true)
      expect(isModelForIntent('qwen2.5-coder:7b', 'coding')).toBe(true)
      expect(isModelForIntent('aya-expanse:8b', 'translation')).toBe(true)
      expect(isModelForIntent('llama3.1:8b', 'chat')).toBe(true)
      expect(isModelForIntent('meditron:7b', 'medical')).toBe(true)
      expect(isModelForIntent('command-r:35b', 'legal')).toBe(true)
    })
  })

  describe('filterModelsByIntent', () => {
    const installedOllamaModels = [
      'qwen2.5-coder:7b',
      'llama3.2-vision:11b',
      'nomic-embed-text:latest',
      'bge-m3:latest',
      'mistral:7b',
      'adrienbrault/biomistral-7b:Q4_K_M',
      'moondream:latest',
      'deepseek-r1:8b',
    ]

    it('should filter Vision OCR list to only vision models and presets', () => {
      const visionList = filterModelsByIntent(installedOllamaModels, 'vision', {
        includeCurrent: 'llama3.2-vision:11b',
        presetOptions: ['llama3.2-vision:11b', 'minicpm-v:8b', 'llava:7b'],
      })

      expect(visionList).toContain('llama3.2-vision:11b')
      expect(visionList).toContain('moondream:latest')
      expect(visionList).toContain('minicpm-v:8b')
      expect(visionList).toContain('llava:7b')

      // Text models and embeddings MUST be excluded
      expect(visionList).not.toContain('qwen2.5-coder:7b')
      expect(visionList).not.toContain('nomic-embed-text:latest')
      expect(visionList).not.toContain('bge-m3:latest')
      expect(visionList).not.toContain('mistral:7b')
      expect(visionList).not.toContain('deepseek-r1:8b')
    })

    it('should filter Embedding list to only embedding models and presets', () => {
      const embeddingList = filterModelsByIntent(installedOllamaModels, 'embedding', {
        includeCurrent: 'nomic-embed-text',
        presetOptions: ['nomic-embed-text', 'bge-m3'],
      })

      expect(embeddingList).toContain('nomic-embed-text:latest')
      expect(embeddingList).toContain('bge-m3:latest')
      expect(embeddingList).toContain('nomic-embed-text')

      expect(embeddingList).not.toContain('qwen2.5-coder:7b')
      expect(embeddingList).not.toContain('llama3.2-vision:11b')
      expect(embeddingList).not.toContain('mistral:7b')
    })

    it('should always preserve custom current model even if unclassified', () => {
      const customModel = 'custom-user-finetune:v1'
      const list = filterModelsByIntent(installedOllamaModels, 'coding', {
        includeCurrent: customModel,
      })

      expect(list).toContain(customModel)
    })
  })

  describe('getModelIntents', () => {
    it('should return multiple valid intents for versatile models', () => {
      const llamaIntents = getModelIntents('llama3.1:8b')
      expect(llamaIntents).toContain('coding')
      expect(llamaIntents).toContain('chat')
      expect(llamaIntents).toContain('translation')
      expect(llamaIntents).not.toContain('vision')
      expect(llamaIntents).not.toContain('embedding')

      const visionIntents = getModelIntents('llama3.2-vision:11b')
      expect(visionIntents).toEqual(['vision'])

      const embedIntents = getModelIntents('nomic-embed-text')
      expect(embedIntents).toEqual(['embedding'])
    })
  })
})
