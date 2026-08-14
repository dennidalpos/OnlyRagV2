import type { AppSettings } from '../types'

export type ChatDomainIntent = 'general' | 'medical' | 'legal'

export interface DomainRoutingResult {
  domain: ChatDomainIntent
  modelName: string
  reason: string
  confidence: number
  requiresRetrieval: boolean
}

// Multi-language triggers for Medical Domain Intent
const MEDICAL_KEYWORDS = [
  'diagnos', 'terapi', 'terapia', 'farmac', 'farmaco', 'medicinal', 'posolog', 'sintom',
  'patolog', 'refert', 'clinico', 'clinica', 'paziente', 'ospedal', 'malatti', 'fisiolog',
  'biomedic', 'esame del sangue', 'emocromo', 'cardiolog', 'oncolog', 'radiolog', 'anamnesi',
  'prognosi', 'chirurg', 'antibiotic', 'vaccin', 'sindrome', 'infezion',
  'disease', 'symptom', 'treatment', 'dosage', 'prescription', 'syndrome', 'biomedical',
  'clinical', 'pathology', 'radiology', 'oncology', 'blood test', 'patient', 'hospital',
  'physician', 'doctor', 'surgery', 'prognosis', 'antibiotic', 'vaccine'
]

// Multi-language triggers for Legal & Compliance Domain Intent
const LEGAL_KEYWORDS = [
  'contratt', 'contratto', 'clausol', 'clausola', 'giurisprudenz', 'risarciment', 'risarcimento',
  'codice civile', 'codice penale', 'tribunale', 'avvocat', 'sentenza', 'decreto', 'normativ',
  'conformit', 'gdpr', 'privacy', 'dpo', 'danno', 'illecito', 'inadempiment', 'querela',
  'citazione', 'ricorso', 'giudice', 'legge n.', 'art.', 'articolo', 'testo unico',
  'contract', 'clause', 'jurisdiction', 'lawsuit', 'liability', 'compliance', 'statute',
  'court', 'attorney', 'lawyer', 'legal', 'regulation', 'gdpr', 'breach of contract',
  'damages', 'indemnity', 'litigation', 'tort', 'verdict', 'decree'
]

// Specialized Centroid Morphemes and Roots for Medical Domain
export const MEDICAL_CENTROID_ROOTS = [
  'cillin', 'mycin', 'prazol', 'statin', 'mab', 'algia', 'emia', 'ectomi', 'pnea',
  'cardia', 'faring', 'laring', 'gastr', 'derm', 'encefal', 'patia', 'edema', 'lesion',
  'biopsi', 'ecograf', 'anamnes', 'fisiol', 'nosolog', 'epidemio', 'sintomat', 'farmacod', 'polmon',
  'epato', 'nefro', 'immun', 'onco', 'glicem', 'ematoc'
]

// Specialized Centroid Morphemes and Roots for Legal & Compliance Domain
export const LEGAL_CENTROID_ROOTS = [
  'giuris', 'decret', 'normat', 'illecit', 'clausol', 'sanzi', 'ademp', 'inademp',
  'ricors', 'appell', 'cassaz', 'tutela', 'risarc', 'indenn', 'responsab', 'obblig', 'patto',
  'rogito', 'prescriz', 'usucap', 'giudic', 'tribun', 'pregiudiz', 'deliber', 'l.n.',
  'societ', 'statut', 'fallim', 'bancarott', 'antiricicl', 'compliance'
]

export function calculateCentroidSimilarity(tokens: string[], centroidRoots: string[]): number {
  if (!tokens || tokens.length === 0 || !centroidRoots || centroidRoots.length === 0) {
    return 0.0
  }

  let matchWeight = 0.0
  for (const token of tokens) {
    if (token.length < 3) continue
    for (const root of centroidRoots) {
      if (token.includes(root)) {
        matchWeight += 1.0
        break
      }
    }
  }

  if (matchWeight === 0) return 0.0
  const normalized = matchWeight / Math.sqrt(tokens.length)
  return Math.min(1.0, Math.round(normalized * 0.45 * 100) / 100)
}

export const CHITCHAT_PATTERNS: RegExp[] = [
  /^ciao\b/i, /^salve\b/i, /^buongiorno\b/i, /^buonasera\b/i, /^come va\b/i, /^come stai\b/i,
  /^chi sei\b/i, /^cosa puoi fare\b/i, /^hello\b/i, /^hi\b/i, /^hey\b/i, /^good morning\b/i,
  /^how are you\b/i, /^who are you\b/i, /^what can you do\b/i, /^thanks\b/i, /^grazie\b/i
]

export function evaluateDomainIntent(
  query: string,
  settings: AppSettings,
  availableModels?: string[]
): DomainRoutingResult {
  const cleanQuery = (query || '').trim().toLowerCase()
  const defaultModel = settings.chatModel || settings.defaultModel || 'llama3.2'

  if (!cleanQuery) {
    return {
      domain: 'general',
      modelName: defaultModel,
      reason: 'Empty query defaults to General Chat model',
      confidence: 1.0,
      requiresRetrieval: false,
    }
  }

  // Check for greetings or direct conversation chitchat
  const isChitChat = CHITCHAT_PATTERNS.some((pattern) => pattern.test(cleanQuery)) && cleanQuery.split(' ').length <= 6
  const requiresRetrieval = !isChitChat

  const queryTokens = cleanQuery.split(/[\s,.;:!?()\[\]"'/\\-]+/).filter((t) => t.length > 2)

  // 1. Keyword match scores
  let medicalKeywordMatches = 0
  for (const kw of MEDICAL_KEYWORDS) {
    if (cleanQuery.includes(kw)) {
      medicalKeywordMatches += 1
    }
  }

  let legalKeywordMatches = 0
  for (const kw of LEGAL_KEYWORDS) {
    if (cleanQuery.includes(kw)) {
      legalKeywordMatches += 1
    }
  }

  if (/\bart(icolo|\.)?\s*\d+/i.test(cleanQuery)) {
    legalKeywordMatches += 2
  }

  // 2. Vector Centroid Similarity
  const medicalCentroidSim = calculateCentroidSimilarity(queryTokens, MEDICAL_CENTROID_ROOTS)
  const legalCentroidSim = calculateCentroidSimilarity(queryTokens, LEGAL_CENTROID_ROOTS)

  // 3. Composite score blending keyword matches and centroid similarity
  const compositeMedical = medicalKeywordMatches * 1.0 + medicalCentroidSim * 2.5
  const compositeLegal = legalKeywordMatches * 1.0 + legalCentroidSim * 2.5

  // Priority evaluation
  if (compositeMedical >= 1.0 && compositeMedical >= compositeLegal) {
    const targetModel = settings.medicalModel?.trim() || defaultModel
    const conf = Math.min(0.98, Math.round((0.65 + Math.min(0.30, compositeMedical * 0.10)) * 100) / 100)
    return {
      domain: 'medical',
      modelName: targetModel,
      reason: `Medical/Clinical Intent detected (Keywords: ${medicalKeywordMatches}, Centroid Sim: ${medicalCentroidSim})`,
      confidence: conf,
      requiresRetrieval,
    }
  }

  if (compositeLegal >= 1.0 && compositeLegal > compositeMedical) {
    const targetModel = settings.legalModel?.trim() || defaultModel
    const conf = Math.min(0.98, Math.round((0.65 + Math.min(0.30, compositeLegal * 0.10)) * 100) / 100)
    return {
      domain: 'legal',
      modelName: targetModel,
      reason: `Legal/Compliance Intent detected (Keywords: ${legalKeywordMatches}, Centroid Sim: ${legalCentroidSim})`,
      confidence: conf,
      requiresRetrieval,
    }
  }

  return {
    domain: 'general',
    modelName: defaultModel,
    reason: 'General Domain standard conversational RAG routing',
    confidence: 0.9,
    requiresRetrieval,
  }
}
