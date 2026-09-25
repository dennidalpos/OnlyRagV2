/**
 * Text Main writes to the agent timeline, as message keys. Main renders the Italian templates
 * below as the entry's `message`/`detail` (the fallback, and what the model and the persisted
 * trackers read); the renderer shows the same keys in the UI language (`agentMain` in
 * src/i18n/locales), so the Italian locale and this table cannot drift.
 */
export const AGENT_MAIN_TEXT_IT = {
  closureMessage: 'Chiusura applicativa: {status}',
  closureOutcomeVerified: 'Esito applicativo: VERIFICATO.',
  closureOutcomeUnverifiable: 'Esito applicativo: NON VERIFICABILE.',
  closureOutcomeBlocked: 'Esito applicativo: BLOCCATO.',
  closureOutcomeCancelled: 'Esito applicativo: ANNULLATO.',
  closureReason: 'Motivo di chiusura: {reason}',
  closureEvidence: 'Evidenza: {evidence}',
  closureModelSummary: 'Ultima consegna del modello: {summary}',
  closureCompleted: 'Completato ({count}):',
  closureOutstanding: 'Residuo ({count}):',
  closureModifiedFiles: 'File modificati ({count}):',
  closureNoChanges: 'Nessuna modifica è stata scritta sul workspace durante questa sessione.',
  evidenceVerificationFailed: 'La verifica "{command}" è fallita.{detail}',
  evidenceProjectCheckFailed: 'La verifica "comando di progetto" è fallita.{detail}',
  evidenceOpenMilestones: '{outstanding} milestone operative aperte e {abandoned} abbandonate.',
  evidenceBehavioralPassed: 'Controllo comportamentale superato.',
  evidenceBehavioralPassedCommand: 'Controllo comportamentale superato: "{command}".',
  evidenceStructuralPassed: 'Controllo strutturale superato; build, typecheck, lint e presenza dei file non provano il comportamento end-to-end.',
  evidenceStructuralPassedCommand:
    'Controllo strutturale superato: "{command}"; build, typecheck, lint e presenza dei file non provano il comportamento end-to-end.',
  evidenceVerificationDisabled: 'La verifica finale è disabilitata nelle impostazioni; nessuna prova comportamentale è stata raccolta.',
  evidenceNoBehavioralCheck: 'Il progetto non espone un controllo comportamentale eseguibile; il risultato non è stato dichiarato funzionante.',
  evidenceGuardStop: 'Run fermato dal guard "{guard}". {evidence}',
  evidencePublishRejected: 'La pubblicazione delle modifiche dal workspace isolato è stata rifiutata.',
  evidencePublishBlocked: 'Pubblicazione bloccata: {error}',
  evidencePublishBlockedUnknown: 'Pubblicazione bloccata: errore sconosciuto',
  reasonFinish: 'Il modello ha segnalato la fine del lavoro; l’applicazione decide l’esito dalle evidenze correnti.',
  reasonStepBudget: 'Raggiunto il limite massimo di passaggi configurato ({max} step).',
  reasonLoopEnded: "Il ciclo dell'agente si è concluso dopo {steps} passaggi.",
  reasonStagnation: 'Pausa per stagnazione: raggiunti {steps} step consecutivi senza progresso.',
  reasonNoMutation: 'Limite di passi senza modifiche raggiunto ({steps} passi di lettura o ispezione senza modifiche ai file).',
  reasonTransportError: 'Errore di trasporto LLM al passo {step}: {error}',
  reasonSchemaBudget:
    "Sessione interrotta: {count} chiamate consecutive a \"{tool}\" sono state rifiutate dalla validazione dei parametri e nessuna e' mai stata eseguita. Il contratto del tool e' stato inviato al modello a ogni tentativo. Nessuna modifica e' stata persa: i file scritti prima di questa serie restano sul disco.",
  reasonModelSilenceOpenWork: 'Il modello ha smesso di invocare strumenti mentre restava lavoro operativo aperto.',
  reasonSummaryWithoutFinish: 'Il modello ha consegnato il riepilogo finale senza richiedere un tool di chiusura.',
  reasonAskGaveUp: 'Il modello ha esaurito il recupero automatico e richiede intervento.',
  reasonAskDecision: "Il modello richiede una decisione dell'utente prima di proseguire.",
  reasonUncertainEffect: 'Effetto incerto dopo "{tool}": l\'operazione non viene ripetuta automaticamente.',
  reasonExecutionRecovery: 'Recupero esecuzione esaurito: {diagnostic}',
  reasonUnsupportedTool: 'Il modello ha chiamato un tool non riconosciuto o non supportato: {tool}',
  diagnosticMessage: 'Diagnostica sessione: {status}',
  diagnosticPhase: 'Fase prima della chiusura: {phase}',
  diagnosticStatus: 'Esito: {status}',
  diagnosticStopReason: 'Motivo di stop: {reason}',
  diagnosticVerification: 'Verifica: {status}',
  diagnosticVerificationNotRun: 'non eseguita',
  diagnosticCommand: 'Comando: {command}',
  diagnosticEvidenceLevel: 'Livello evidenza: {level}',
  diagnosticVerificationDetail: 'Dettaglio verifica: {detail}',
  diagnosticSchemaRecovery: 'Recupero schema: {used}/{limit}',
  diagnosticExecutionRecovery: 'Recupero esecuzione: {used}/{limit}',
  diagnosticVerificationFixes: 'Correzioni verifica: {used}/{limit}',
  diagnosticGuards: 'Guard: {guards}',
  diagnosticRuntime: 'Runtime: modello={model}; digest={digest}; num_ctx={numCtx}; num_predict={numPredict}',
  diagnosticLastGeneration: 'Ultima generazione: step={step}; durata={durationMs}ms; prompt={promptTokens} token; output={completionTokens} token',
  diagnosticUnavailable: 'non disponibile',
  diagnosticNotAvailableShort: 'n/d',
} as const

export type AgentMainTextKey = keyof typeof AGENT_MAIN_TEXT_IT

/** A parameter is verbatim text (model output, paths, commands) or a nested localized text. */
export type AgentTextParam = string | number | AgentLocalizedText

export interface AgentLocalizedText {
  key: AgentMainTextKey
  params?: Readonly<Record<string, AgentTextParam>>
}

/** One line of a localized detail: a localized sentence or verbatim text. */
export type AgentLocalizedLine = AgentLocalizedText | { text: string }

/** The localized form of an agent log entry; absent parts fall back to `message`/`detail`. */
export interface AgentLocalizedLog {
  message?: AgentLocalizedText
  detail?: AgentLocalizedLine[]
}

/** Replaces `{name}` with each parameter, the interpolation the renderer's `t` uses too. */
export function interpolateTemplate(template: string, params: Readonly<Record<string, string | number>>): string {
  return Object.entries(params).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), template)
}

/** Renders a localized text with `translate`, resolving nested parameters first. */
export function formatAgentText(text: AgentLocalizedText, translate: (key: AgentMainTextKey, params: Record<string, string | number>) => string): string {
  const params: Record<string, string | number> = {}
  for (const [name, value] of Object.entries(text.params ?? {})) {
    params[name] = typeof value === 'object' ? formatAgentText(value, translate) : value
  }
  return translate(text.key, params)
}

/** The Italian rendering Main writes as the entry's fallback text. */
export function formatAgentTextIt(text: AgentLocalizedText): string {
  return formatAgentText(text, (key, params) => interpolateTemplate(AGENT_MAIN_TEXT_IT[key], params))
}

/** Renders detail lines, one per line, with `format` for the localized ones. */
export function renderAgentLines(lines: readonly AgentLocalizedLine[], format: (text: AgentLocalizedText) => string = formatAgentTextIt): string {
  return lines.map((line) => ('text' in line ? line.text : format(line))).join('\n')
}

function mapTextStrings(text: AgentLocalizedText, map: (value: string) => string): AgentLocalizedText {
  if (!text.params) return text
  const params: Record<string, AgentTextParam> = {}
  for (const [name, value] of Object.entries(text.params)) {
    params[name] = typeof value === 'string' ? map(value) : typeof value === 'object' ? mapTextStrings(value, map) : value
  }
  return { ...text, params }
}

/** Applies `map` to every verbatim string of a localized log (keys stay untouched), e.g. secret redaction. */
export function mapAgentLocalizedStrings(localized: AgentLocalizedLog, map: (value: string) => string): AgentLocalizedLog {
  return {
    ...(localized.message ? { message: mapTextStrings(localized.message, map) } : {}),
    ...(localized.detail ? { detail: localized.detail.map((line) => ('text' in line ? { text: map(line.text) } : mapTextStrings(line, map))) } : {}),
  }
}
