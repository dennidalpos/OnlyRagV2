import { describe, it, expect } from 'vitest'
import { TextRankSummarizer } from '../../../../shared/domain/nlp/textRankSummarizer'

describe('TextRankSummarizer NLP Unit Tests', () => {
  const sampleItalianText = `
    OnlyRag V2 è un'applicazione desktop per intelligenza artificiale locale con supporto RAG.
    L'architettura del sistema si basa su Electron, React 19, TypeScript e un sidecar FastAPI.
    Il database vettoriale embedded LanceDB memorizza i chunk dei documenti indicizzati localmente.
    I modelli LLM vengono eseguiti esclusivamente tramite Ollama su hardware locale per garantire totale privacy.
    La compattazione automatica del contesto permette di gestire conversazioni lunghe senza perdita di informazioni.
    La compilazione dei prompt rispetta rigorosamente i limiti di memoria VRAM e RAM dell'host.
  `

  it('should split text into clean sentences', () => {
    const sentences = TextRankSummarizer.splitSentences(sampleItalianText)
    expect(sentences.length).toBeGreaterThanOrEqual(5)
    expect(sentences[0]).toContain('OnlyRag V2')
  })

  it('should compute similarity between related sentences', () => {
    const tokensA = TextRankSummarizer.tokenize('OnlyRag V2 gestisce modelli LLM locali con Ollama')
    const tokensB = TextRankSummarizer.tokenize('I modelli LLM vengono eseguiti tramite Ollama in locale')
    const sim = TextRankSummarizer.computeSimilarity(tokensA, tokensB)
    expect(sim).toBeGreaterThan(0.5)
  })

  it('should extract the most salient summary sentences via PageRank power iteration', () => {
    const summary = TextRankSummarizer.summarize(sampleItalianText, { targetSentences: 2 })
    expect(summary).toBeTruthy()
    const sentences = summary.split(/\.\s+/)
    expect(sentences.length).toBeLessThanOrEqual(3)
  })
})
