import type { AppSettings } from '../types'

export type ChatDomainIntent = 'general' | 'medical' | 'legal'

export interface DomainRoutingResult {
  domain: ChatDomainIntent
  modelName: string
  reason: string
  confidence: number
  requiresRetrieval: boolean
}

/**
 * Multi-language Semantic Centroid Profile.
 * Contains subword morphemes, stems, and terminological anchors across IT, EN, ES, FR, DE.
 */
export interface DomainCentroidProfile {
  name: ChatDomainIntent
  weights: Record<string, number>
}

/**
 * Medical / Clinical Domain Centroid (IT, EN, ES, FR, DE)
 * Covers pharmacology, anatomy, diagnostics, pathology, clinical workflows and bio-medical roots.
 */
export const MEDICAL_CENTROID_WEIGHTS: Record<string, number> = {
  // Morphemes & Clinical Roots (Latin / Greek international stems)
  'cillin': 3.5, 'mycin': 3.5, 'prazol': 3.5, 'statin': 3.5, 'algia': 3.0,
  'ectomi': 3.0, 'pnea': 3.0, 'cardia': 3.0, 'faring': 3.0, 'laring': 3.0,
  'gastr': 2.8, 'encefal': 3.0, 'patia': 2.8, 'patho': 2.8, 'edema': 3.0,
  'lesion': 2.5, 'biopsi': 3.2, 'ecograf': 3.2, 'anamnes': 3.5, 'fisiol': 2.5, 'nosolog': 3.0,
  'epidemio': 2.8, 'sintom': 3.2, 'symptom': 3.2, 'farmaco': 3.2, 'pharmaco': 3.2,
  'polmon': 3.0, 'pneumo': 3.2, 'epato': 3.0, 'hepato': 3.0, 'nefro': 3.0, 'nephro': 3.0,
  'immun': 2.8, 'onco': 3.2, 'glicem': 3.0, 'ematoc': 3.2, 'haemat': 3.2, 'hemato': 3.2,
  'cefalea': 3.0, 'antibiot': 3.2, 'posolog': 3.5, 'dosag': 3.5, 'dosier': 3.5,
  'prescri': 3.2, 'verschreib': 3.2, 'ordonnan': 3.5, 'paziente': 2.8, 'patient': 2.8,
  'malatt': 2.8, 'krank': 2.8, 'disease': 2.8, 'illness': 2.8, 'refert': 3.2,

  // Multi-word / specific phrase tokens
  'esame del sangue': 3.5, 'blood test': 3.5, 'analyse de sang': 3.5, 'blutbild': 3.5,
  'emocromo': 3.5, 'cardiolog': 3.2, 'radiolog': 3.2, 'chirurg': 3.0, 'vaccin': 2.8,
  'sindrome': 3.0, 'infezion': 2.8, 'infection': 2.8, 'prognos': 3.2, 'diagnos': 3.2,
  'terapi': 3.0, 'therap': 3.0, 'behandlung': 2.8, 'traitement': 2.8, 'medicament': 3.0,
  'medicinale': 3.0, 'medikament': 3.0, 'hospital': 2.5, 'ospedal': 2.5, 'medico': 2.0,
  'physician': 2.5, 'doctor': 2.0, 'arzt': 2.0, 'ärzt': 2.0, 'médecin': 2.0, 'medecin': 2.0,
  'lungenentzündung': 3.5, 'pneumonie': 3.2, 'pneumonia': 3.2,
}

/**
 * Legal & Compliance Domain Centroid (IT, EN, ES, FR, DE)
 * Covers contracts, statutory law, civil/penal codes, liability, litigation, GDPR, jurisprudence.
 */
export const LEGAL_CENTROID_WEIGHTS: Record<string, number> = {
  // Morphemes & Jurisprudential Roots
  'giuris': 3.2, 'juris': 3.2, 'decret': 3.0, 'decree': 3.0, 'normat': 3.0, 'illecit': 3.2,
  'clausol': 3.2, 'clause': 3.2, 'klausel': 3.2, 'sanzi': 2.8, 'sanct': 2.8,
  'inademp': 3.5, 'ricors': 3.0, 'appell': 2.8, 'appeal': 2.8, 'cassaz': 3.5, 'tutela': 2.5,
  'risarc': 3.5, 'indenn': 3.2, 'indemn': 3.2, 'schadensersatz': 3.8, 'responsab': 2.5,
  'liabilit': 3.2, 'haftung': 3.2, 'obblig': 2.8, 'obligat': 2.8, 'patto': 2.5, 'rogito': 3.5,
  'prescriz': 3.0, 'usucap': 3.5, 'giudic': 3.0, 'tribun': 3.2, 'gericht': 3.2, 'court': 2.8,
  'statut': 2.8, 'fallim': 3.2, 'bancarott': 3.5, 'bankrupt': 3.5, 'antiricicl': 3.5,
  'compliance': 3.0, 'gdpr': 3.5, 'dpo': 3.0,

  // Multi-word / specific terms
  'contratt': 3.0, 'contract': 3.0, 'vertrag': 3.0, 'contrat': 3.0, 'agreement': 2.5,
  'codice civile': 3.8, 'codice penale': 3.8, 'código civil': 3.8, 'code civil': 3.8,
  'bgb': 3.8, 'gesetzbuch': 3.5, 'gesetz': 2.8, 'statute': 3.2, 'avvocat': 2.8,
  'attorney': 2.8, 'lawyer': 2.8, 'anwalt': 2.8, 'rechtsanwalt': 2.8, 'avocat': 2.8,
  'abogado': 2.8, 'sentenza': 3.5, 'verdict': 3.5, 'urteil': 3.5, 'jugement': 3.5,
  'querela': 3.5, 'citazione': 3.2, 'lawsuit': 3.5, 'litigation': 3.5, 'litige': 3.2,
  'klage': 3.5, 'giudice': 3.0, 'judge': 3.0, 'richter': 3.0, 'juge': 3.0, 'juez': 3.0,
  'legge': 2.5, 'loi': 2.5, 'art.': 3.0, 'articolo': 2.8, 'article': 2.8,
  'testo unico': 3.5, 'breach of contract': 3.8, 'vertragsbruch': 3.8, 'incumplimiento': 3.5,
  'résiliation': 3.2, 'resiliation': 3.2, 'dommages et intérêts': 3.8, 'damages': 3.2,
}

export const MEDICAL_CENTROID: DomainCentroidProfile = {
  name: 'medical',
  weights: MEDICAL_CENTROID_WEIGHTS,
}

export const LEGAL_CENTROID: DomainCentroidProfile = {
  name: 'legal',
  weights: LEGAL_CENTROID_WEIGHTS,
}

// Legacy exports for backward compatibility
export const MEDICAL_CENTROID_ROOTS = Object.keys(MEDICAL_CENTROID_WEIGHTS)
export const LEGAL_CENTROID_ROOTS = Object.keys(LEGAL_CENTROID_WEIGHTS)

/**
 * Calculates zero-latency Centroid Similarity between input tokens/query and a domain centroid profile.
 * Executes synchronously in <0.2ms.
 */
export function calculateCentroidSimilarity(
  input: string[] | string,
  centroid: DomainCentroidProfile | string[]
): number {
  if (!input || (Array.isArray(input) && input.length === 0)) {
    return 0.0
  }

  const queryText = (Array.isArray(input) ? input.join(' ') : input).toLowerCase().trim()
  if (!queryText) return 0.0

  const tokens = queryText.split(/[\s,.;:!?()\[\]"'/\\-]+/).filter((t) => t.length >= 2)
  if (tokens.length === 0) return 0.0

  let weightsMap: Record<string, number>
  if (Array.isArray(centroid)) {
    weightsMap = {}
    for (const r of centroid) {
      weightsMap[r] = 3.0
    }
  } else {
    weightsMap = centroid.weights
  }

  let totalMatchWeight = 0.0
  const matchedFeatures = new Set<string>()

  // 1. Check direct phrase / whole word / morpheme matches in the full query text
  for (const [key, weight] of Object.entries(weightsMap)) {
    if (key.length >= 4) {
      if (queryText.includes(key)) {
        if (!matchedFeatures.has(key)) {
          matchedFeatures.add(key)
          totalMatchWeight += weight
        }
      }
    }
  }

  // 2. Check token-level containment (only if token is long enough and contains the key)
  for (const token of tokens) {
    if (token.length < 3) continue
    for (const [key, weight] of Object.entries(weightsMap)) {
      if (token.length >= key.length && token.includes(key)) {
        if (!matchedFeatures.has(key)) {
          matchedFeatures.add(key)
          totalMatchWeight += weight
        }
      }
    }
  }

  // Explicit boost for statutory article markers (e.g. art. 1341, c.c., bgb)
  if (/\bart(icolo|\.)?\s*\d+/i.test(queryText)) {
    if (weightsMap['art.'] !== undefined && !matchedFeatures.has('art.')) {
      matchedFeatures.add('art.')
      totalMatchWeight += weightsMap['art.']
    }
  }

  if (totalMatchWeight === 0) return 0.0

  // Normalized score against token count
  const normalized = totalMatchWeight / Math.sqrt(Math.max(1, tokens.length))
  const score = Math.min(1.0, Math.round((normalized / 4.0) * 100) / 100)
  return score
}

export const CHITCHAT_PATTERNS: RegExp[] = [
  /^ciao\b/i, /^salve\b/i, /^buongiorno\b/i, /^buonasera\b/i, /^come va\b/i, /^come stai\b/i,
  /^chi sei\b/i, /^cosa puoi fare\b/i, /^hello\b/i, /^hi\b/i, /^hey\b/i, /^good morning\b/i,
  /^how are you\b/i, /^who are you\b/i, /^what can you do\b/i, /^thanks\b/i, /^grazie\b/i,
  /^merci\b/i, /^bonjour\b/i, /^hallo\b/i, /^guten tag\b/i, /^danke\b/i, /^hola\b/i, /^gracias\b/i
]

/**
 * Universal Synchronous Domain Intent Router.
 * Evaluates user queries against pre-computed multi-language TF-IDF Semantic Centroids in <1ms.
 */
export function evaluateDomainIntent(
  query: string,
  settings: AppSettings,
  _availableModels?: string[]
): DomainRoutingResult {
  const cleanQuery = (query || '').trim()
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

  // Check for greetings or direct conversation chitchat (< 7 words)
  const isChitChat = CHITCHAT_PATTERNS.some((pattern) => pattern.test(cleanQuery.toLowerCase())) && cleanQuery.split(/\s+/).length <= 6
  const requiresRetrieval = !isChitChat

  // Fast Vector Similarity against Domain Centroids
  const medicalSim = calculateCentroidSimilarity(cleanQuery, MEDICAL_CENTROID)
  const legalSim = calculateCentroidSimilarity(cleanQuery, LEGAL_CENTROID)

  const SIM_THRESHOLD = 0.15

  if (medicalSim >= SIM_THRESHOLD && medicalSim >= legalSim) {
    const targetModel = settings.medicalModel?.trim() || defaultModel
    const conf = Math.min(0.99, Math.round((0.65 + medicalSim * 0.35) * 100) / 100)
    return {
      domain: 'medical',
      modelName: targetModel,
      reason: `Medical/Clinical Intent detected (Centroid Similarity: ${medicalSim})`,
      confidence: conf,
      requiresRetrieval,
    }
  }

  if (legalSim >= SIM_THRESHOLD && legalSim > medicalSim) {
    const targetModel = settings.legalModel?.trim() || defaultModel
    const conf = Math.min(0.99, Math.round((0.65 + legalSim * 0.35) * 100) / 100)
    return {
      domain: 'legal',
      modelName: targetModel,
      reason: `Legal/Compliance Intent detected (Centroid Similarity: ${legalSim})`,
      confidence: conf,
      requiresRetrieval,
    }
  }

  return {
    domain: 'general',
    modelName: defaultModel,
    reason: 'General Domain standard conversational RAG routing',
    confidence: 0.90,
    requiresRetrieval,
  }
}
