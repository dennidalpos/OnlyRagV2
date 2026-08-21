/**
 * Standard Graph-Based NLP TextRank / LexRank Extractive Summarizer.
 * Implements Mihalcea & Tarau (2004) TextRank algorithm with PageRank power iteration
 * over sentence similarity graphs across IT, EN, ES, FR, DE.
 */

export interface TextRankOptions {
  /** Target number of summary sentences to extract (default: 3) */
  targetSentences?: number
  /** Damping factor for PageRank graph random walk (default: 0.85) */
  dampingFactor?: number
  /** Convergence tolerance for power iteration (default: 0.0001) */
  tolerance?: number
  /** Maximum power iteration cycles (default: 50) */
  maxIterations?: number
  /** Minimum sentence length in characters to be considered (default: 15) */
  minSentenceLength?: number
}

export interface ScoredSentence {
  index: number
  text: string
  score: number
  tokens: Set<string>
}

export class TextRankSummarizer {
  private static readonly STOP_WORDS = new Set([
    // Italian
    'il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'uno', 'una', 'di', 'a', 'da', 'in', 'con', 'su',
    'per', 'tra', 'fra', 'e', 'ed', 'o', 'od', 'ma', 'se', 'perché', 'perche', 'come', 'che',
    'chi', 'cui', 'non', 'più', 'piu', 'molto', 'poco', 'questo', 'questa', 'questi', 'queste',
    'quello', 'quella', 'quelli', 'quelle', 'sono', 'sei', 'è', 'era', 'stato', 'stata', 'ha',
    'hanno', 'aveva', 'anche', 'delle', 'dello', 'degli', 'della', 'dei', 'dal', 'dallo', 'dalla',
    'dai', 'dagli', 'dalle', 'nel', 'nello', 'nella', 'nei', 'negli', 'nelle', 'sul', 'sullo',
    'sulla', 'sui', 'sugli', 'sulle', 'cosa', 'fare', 'fatto', 'tutto', 'tutti', 'tutte',
    // English
    'the', 'a', 'an', 'and', 'or', 'but', 'if', 'because', 'as', 'what', 'which', 'this', 'that',
    'these', 'those', 'then', 'so', 'than', 'such', 'both', 'through', 'about', 'for', 'is', 'are',
    'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'to', 'from',
    'in', 'out', 'on', 'off', 'over', 'under', 'again', 'further', 'once', 'here', 'there', 'when',
    'where', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some',
    'with', 'without', 'not', 'only', 'same', 'can', 'will', 'just', 'should', 'now',
    // French / Spanish / German common connectors
    'le', 'la', 'les', 'des', 'du', 'dans', 'pour', 'avec', 'sur', 'est', 'sont', 'une', 'qui',
    'el', 'los', 'las', 'del', 'por', 'para', 'con', 'que', 'una', 'uno', 'los', 'las',
    'der', 'die', 'das', 'dem', 'den', 'des', 'und', 'oder', 'aber', 'mit', 'auf', 'für', 'von',
  ])

  /**
   * Splits input text into discrete sentences using multi-language punctuation boundaries.
   */
  public static splitSentences(text: string, minLength = 15): string[] {
    if (!text || typeof text !== 'string') return []

    // Clean markdown code blocks, headers, bullet symbols
    const clean = text
      .replace(/```[\s\S]*?```/g, ' [codice] ')
      .replace(/`[^`]+`/g, ' [token] ')
      .replace(/^#+\s+/gm, '')
      .replace(/^[•\-\*\+]\s+/gm, '')

    // Split on period/question/exclamation followed by space or newline, or multi-newlines
    const rawSentences = clean
      .split(/(?<=[.?!;:\n])\s+(?=[A-ZÀ-ÖØ-ö0-9\(\[\"'])/g)
      .flatMap((s) => s.split(/\n{2,}/))

    return rawSentences
      .map((s) => s.replace(/\s+/g, ' ').trim())
      .filter((s) => s.length >= minLength && !/^[0-9\W]+$/.test(s))
  }

  /**
   * Tokenizes and stems a sentence into a set of lowercased content words (excluding stop words).
   */
  public static tokenize(sentence: string): Set<string> {
    const words = sentence
      .toLowerCase()
      .split(/[\s,.;:!?()\[\]"'/\\#*~`<>+=\-_]+/)
      .filter((w) => w.length >= 3 && !this.STOP_WORDS.has(w))

    return new Set(words)
  }

  /**
   * Computes BM25-normalized logarithmic similarity between two sentence token sets.
   */
  public static computeSimilarity(tokensA: Set<string>, tokensB: Set<string>): number {
    if (tokensA.size === 0 || tokensB.size === 0) return 0.0

    let commonCount = 0
    for (const token of tokensA) {
      if (tokensB.has(token)) {
        commonCount++
      }
    }

    if (commonCount === 0) return 0.0

    // Mihalcea & Tarau TextRank normalization: common / (log(sizeA) + log(sizeB))
    const norm = Math.log(tokensA.size + 1) + Math.log(tokensB.size + 1)
    return norm > 0 ? commonCount / norm : 0.0
  }

  /**
   * Executes PageRank power iteration over the sentence similarity graph.
   */
  public static summarize(text: string, options: TextRankOptions = {}): string {
    const {
      targetSentences = 3,
      dampingFactor = 0.85,
      tolerance = 0.0001,
      maxIterations = 50,
      minSentenceLength = 15,
    } = options

    const sentences = this.splitSentences(text, minSentenceLength)
    if (sentences.length === 0) return ''
    if (sentences.length <= targetSentences) return sentences.join(' ')

    // 1. Build sentence nodes and token sets
    const nodes: ScoredSentence[] = sentences.map((s, idx) => ({
      index: idx,
      text: s,
      score: 1.0,
      tokens: this.tokenize(s),
    }))

    const n = nodes.length
    // 2. Build adjacency weight matrix
    const weights: number[][] = Array.from({ length: n }, () => Array(n).fill(0))
    const outSums: number[] = Array(n).fill(0)

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const sim = this.computeSimilarity(nodes[i].tokens, nodes[j].tokens)
        if (sim > 0) {
          weights[i][j] = sim
          weights[j][i] = sim
          outSums[i] += sim
          outSums[j] += sim
        }
      }
    }

    // 3. Power iteration PageRank convergence loop
    for (let iter = 0; iter < maxIterations; iter++) {
      let maxDelta = 0.0
      const nextScores = Array(n).fill(0)

      for (let i = 0; i < n; i++) {
        let rankSum = 0.0
        for (let j = 0; j < n; j++) {
          if (i !== j && weights[j][i] > 0 && outSums[j] > 0) {
            rankSum += (weights[j][i] / outSums[j]) * nodes[j].score
          }
        }
        nextScores[i] = (1 - dampingFactor) + dampingFactor * rankSum
        const delta = Math.abs(nextScores[i] - nodes[i].score)
        if (delta > maxDelta) maxDelta = delta
      }

      for (let i = 0; i < n; i++) {
        nodes[i].score = nextScores[i]
      }

      if (maxDelta < tolerance) break
    }

    // 4. Select top K highest scoring sentences, sorted by original document appearance order
    const sortedByRank = [...nodes].sort((a, b) => b.score - a.score)
    const selectedNodes = sortedByRank.slice(0, targetSentences)
    selectedNodes.sort((a, b) => a.index - b.index)

    return selectedNodes.map((n) => n.text).join(' ')
  }
}
