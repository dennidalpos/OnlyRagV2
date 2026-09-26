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
  executionRecoveryAttempt: 'Recupero esecuzione {used}/{limit}: correzione richiesta.',
  planRemappedAlias: 'Piano aggiornato: {milestones} puntavano a "{from}", che non esiste; ora puntano a "{to}".',
  planRemappedMove: 'Piano aggiornato dopo lo spostamento: {milestones} ora puntano a {target}.',
  versionQuestionAnswered: '📦 Domanda sulle versioni risolta dal registro npm: {question}',
  redundantAskIntercepted:
    "⚡ Proactive Auto-Healing: Intercettata richiesta di permesso/chiarimento ridondante. L'agente procede direttamente con l'implementazione.",
  circuitBreakerTriggered: '⚠️ Circuit Breaker Triggered: {reason}',
  circuitBreaker: '⚠️ Circuit Breaker: {reason}',
  milestoneStillMissing: '📄 Milestone {id}: mancano ancora {missing}.',
  milestoneRedelivered: '🔁 Milestone {id} era gia\' completa: la riscrittura di "{path}" non ha fatto avanzare il piano.',
  milestoneAwaitingVerification: '✏️ Milestone {id}: scritto "{path}", tutti i file richiesti sono presenti. In attesa di una verifica che passi.',
  failedCommandLeftDirs: "🧹 Il comando fallito ha lasciato {dirs} nel workspace: richiesta pulizia all'agente.",
  nestedProjectDirs: '📁 Il comando ha creato {dirs} annidata nel workspace: il progetto deve stare nella radice.',
  commandTrackedFiles: '📂 {count} file tracciati dal comando eseguito{truncated}.',
  commandScanTruncated: ' (scansione troncata: workspace molto grande)',
  milestonesVerifiedBy: '✅ {count} milestone verificate da "{command}": {ids} ({completed}/{total}).',
  previewNotRendered: '👁️ Anteprima aperta su "{target}": non vale come verifica, non è una pagina renderizzata.',
  previewNotRenderedHint: 'Esegui una build, un typecheck o un test per verificare il progetto.',
  previewNotPromoting: '👁️ Anteprima aperta su "{target}": evidenza raccolta, ma non promuove il milestone a verified.',
  previewNotPromotingHint: 'Esegui build, typecheck o test con esito positivo per ottenere la verifica del progetto.',
  dodPrematureFinish: '⛔ DoD Guard: Chiusura rifiutata — Nessun file creato o modificato nel workspace.',
  milestoneAbandoned: '⏭️ Escape strutturale: milestone {id} abbandonata dopo {blocks} blocchi consecutivi.',
  milestoneNextActive: 'Nuova milestone attiva: {id}: {title}',
  milestoneNoneLeft: 'Nessuna milestone operativa rimasta.',
  loopGuardYielded: '▶️ Loop guard sospeso: "{target}" è l’azione ordinata dalla direttiva del piano ({kind}).',
  loopGuardYieldedDetail: 'Bloccarlo avrebbe lasciato il modello senza alcuna mossa eseguibile.',
  redundantAction: '♻️ Azione ridondante: {tool} già riuscito, ripetuto {count} volte',
  redundantNoStagnation: 'Nessuna stagnazione conteggiata: il modello è invitato ad avanzare al passo successivo.',
  loopPrevented: '⚠️ Loop bloccato: {tool} ripetuto {count} volte',
  loopDetailSessionClosure: 'Progetto già verificato e nulla di aperto da dimostrare: al modello è stato chiesto di chiudere la sessione.',
  loopDetailDependenciesUndeclared: 'Il codice importa pacchetti non dichiarati in package.json: al modello è stato chiesto di installarli.',
  loopDetailDependenciesMissing: 'Dipendenze dichiarate ma non installate: al modello è stato chiesto di eseguire npm install.',
  loopDetailVerificationDue: 'Tutti i deliverable sono su disco: al modello è stato chiesto di eseguire il comando di verifica del progetto.',
  loopDetailStrategyChange: 'Intervento automatico: cambio di strategia inviato al modello.',
  gitCommitBlocked: 'Git commit bloccato: {error}',
  gitCommitDenied: "🚫 git_commit rifiutato dall'utente.",
  commandBlocked: '🔒 Comando bloccato: {reason}',
  commandUnsafe: 'non sicuro',
  actionDenied: "🚫 Azione rifiutata dall'utente: {tool}",
  modeToolBlocked: '🔒 [{mode}] Tool bloccato: {tool}',
  versionReadByApp: "🔄 Lettura versione eseguita dall'applicazione: {path} (proposto: {proposed}).",
  shellReadAsReadFile: '📖 Lettura shell eseguita come read_file: {path} (proposto: {command}).',
  phaseToolBlocked: '🧰 Tool bloccato dalla fase corrente: {tool}',
  gitCommitDeferred: 'Git commit rinviato: pubblica prima le modifiche isolate.',
  transportRecovery: 'Recupero trasporto Ollama 1/1 dopo: {error}',
  llmStreamError: 'Errore dello stream LLM al passo {step}: {error}',
  agentThoughtHeader: 'AI Agent ({mode} passo {step}):',
  toolCallRejected: 'Passo {step}: chiamata tool rifiutata [{tool}]. Recupero schema {used}/{limit}: {errors}',
  noToolCall: 'Passo {step}: nessuna chiamata tool nella risposta del modello. Richiesta una chiamata tool.',
  toolCallHeader: 'Passo {step}: chiamata tool [{tool}]:',
  contextClamped: '📏 Contesto limitato dal modello: {hardware} → {ceiling} token ({model} è addestrato a {ceiling}; Ollama troncherebbe il prompt).',
  contextPreference: '📏 Preferenza contesto applicata: {previous} → {preferred} token ({model}).',
  contextPolicy: '🎯 Policy contesto [{kind}]: {reason} — omessi {omitted}.',
  toolPolicy: '🧰 Policy tool [{kind}]: {reason} — {tools}.',
  toolCommandFinished: 'Comando terminale completato: {command}',
  toolCommandFailed: 'Comando terminale fallito (diagnostica acquisita).',
  toolCommandException: 'Errore esecuzione terminale: {error}',
  toolTerminalDisabled: 'Esecuzione dei comandi terminale disabilitata nelle impostazioni.',
  toolCommandMissing: 'Parametro del comando mancante.',
  finalVerificationStarted: '🔎 Verifica finale governata dall’applicazione...',
  finalVerificationFailed: '🔒 Verifica fallita (giro {round}): correzione richiesta.',
  workspaceError: '❌ Errore Workspace: {error}',
  preflightCheck: '{mark} Preflight {id}: {detail}',
  executionGuardNotice: '⚡ Guardia di esecuzione: {reason}',
  skillInstallConfirm: "🧩 Skill Hub: richiesta conferma installazione '{skill}' da {hub} (score {score})",
  skillsActivated: '✨ Skill Router: attivate {count} skill [{skills}]',
  milestoneEvidenceStale: '♻️ {count} evidenze di milestone salvate da riverificare.',
  planMilestonesLoaded: 'Caricate {count} milestone del piano approvato per questa run.',
  sessionTimeout: '⏱️ Session Timeout: Sessione terminata automaticamente: superato il limite di {minutes} minuti.',
  toolActionError: 'Errore {tool}: {error}',
  toolPathOutsideWorkspace: '{tool} rifiutato: percorso fuori dal workspace',
  toolWriteDisabled: 'Scrittura file disabilitata nelle impostazioni',
  toolModifyDisabled: 'Modifica file disabilitata nelle impostazioni',
  toolDeleteDisabled: 'Eliminazione file disabilitata nelle impostazioni',
  toolDirectoryDisabled: 'Creazione cartelle disabilitata nelle impostazioni',
  toolCopyDisabled: 'Copia file disabilitata nelle impostazioni',
  toolMoveDisabled: 'Spostamento file disabilitato nelle impostazioni',
  toolDownloadDisabled: 'Download file disabilitato nelle impostazioni',
  toolDeleteDone: 'File eliminato: {file}',
  toolDirectoryCreated: 'Cartella creata: {dir}',
  toolCopyDone: 'Copiato {source} -> {target}',
  toolMoveDone: 'Spostato {source} -> {target}',
  toolGrepNone: 'Ricerca testo: nessuna corrispondenza per "{query}"',
  toolGrepFound: 'Ricerca testo: {count} corrispondenze per "{query}"',
  toolDownloadFailed: 'Download non riuscito: {error}',
  toolDownloadDone: 'Scaricati {bytes} byte in {file}',
  toolRollbackWorkspaceDone: 'Ripristino workspace: {count} file ripristinati',
  toolRollbackStepEmpty: 'Annulla ultimo passo: niente da annullare',
  toolRollbackStepDone: 'Annulla ultimo passo: {count} file ripristinati',
  toolShellToolConfusion: '[TOOL_AS_SHELL_BLOCK] Bloccata l\'esecuzione in shell del tool "{tool}"',
  toolDevServerBlocked: '[BLOCKING_DEV_SERVER_BLOCK] Bloccato un comando che non termina: "{command}"',
  toolInstallUnknownPackage: 'Installazione rifiutata: {package} non esiste su npm',
  toolInstallInvalidVersion: 'Installazione rifiutata: {package} ha una versione richiesta {kind}',
  toolInstallDowngrade: 'Installazione rifiutata: porterebbe {package} sotto la major dichiarata',
  toolInstallRedundant: '[REDUNDANT_INSTALL_SKIP] Già installati: {packages}',
  toolOsInventory: 'Ambiente del sistema e toolchain di sviluppo',
  toolEnsureNotAllowed: "ensure_tool rifiutato: '{tool}' non è nella lista consentita",
  toolEnsurePresent: '{name} già presente ({version})',
  toolEnsureTerminalDisabled: 'ensure_tool bloccato: esecuzione terminale disabilitata',
  toolEnsureNoPackage: 'ensure_tool: nessun pacchetto per {tool}',
  toolEnsureUnsupportedPlatform: 'ensure_tool: piattaforma non supportata',
  toolEnsureInstalled: 'Installato {name} ({tool} {version})',
  toolEnsureStillMissing: "ensure_tool: {name} ancora assente dopo l'installazione",
  toolEnsureException: 'Eccezione ensure_tool: {error}',
  toolSecurityBlock: '[SECURITY BLOCK] Comando vietato: "{command}"',
  toolSecurityApprovalRequired: '[SECURITY APPROVAL REQUIRED] Comando: "{command}"',
  toolPolicyBlock: '[POLICY BLOCK] {tool}: {reason}',
  toolTurnPolicyDenied: 'Tool non disponibile in questa fase: {tool}',
  toolVisualUnavailable: 'Validazione visiva non disponibile: {error}',
  toolVisualDone: 'Validazione visiva {status}: {target}',
  toolUnsupported: 'Tool non supportato: {tool}',
  toolDirNotFound: 'Cartella non trovata: {path}',
  toolFileNotFound: 'File non trovato: {path}',
  toolEditPathRejected: '{tool} rifiutato: {error}',
  toolEditMissingParams: '{tool}: parametri mancanti',
  toolEditSkillViolation: '{tool} rifiutato: viola la skill attiva {skill}',
  toolEditStaleVersion: '{tool} rifiutato: versione non aggiornata di {file}',
  toolEditConcurrentChange: '{tool} rifiutato: {file} è cambiato nel frattempo',
  toolEditSyntaxError: '{tool} rifiutato (errore di sintassi): {error}',
  toolEditFailed: '{tool} non riuscito in {file}: {error}',
  toolSymbolsNone: 'Simboli di codice: nessuno in {file}',
  toolSymbolsFound: 'Simboli di codice: {count} in {file}',
  toolSymbolsError: 'Errore estrazione simboli: {error}',
  toolFileInfoDone: 'Informazioni file lette: {file}',
  toolFileInfoError: 'Errore informazioni file: {error}',
  toolListDirDone: 'Contenuto cartella: {count} elementi',
  toolListDirError: 'Errore lettura cartella: {error}',
  toolListRecursiveDone: 'Elenco ricorsivo: {count} elementi in {path}',
  toolListRecursiveError: 'Errore elenco ricorsivo: {error}',
  toolMultiReplaceDone: '{count} sostituzioni applicate in {file}',
  toolReadDirectoryListed: 'read_file su una cartella: elencata invece ({count} elementi)',
  toolReadDone: 'File letto{range}',
  toolReadError: 'Errore lettura file: {error}',
  toolReplaceDone: 'Sostituzione applicata in {file}',
  toolWriteDirectoryPath: 'write_file rifiutato: "{path}" indica una cartella ma è stato fornito un contenuto',
  toolWriteRoutedToDirectory: 'Cartella {dir} creata (write_file instradato su create_directory)',
  toolCreateDirectoryError: 'Errore nella creazione della cartella: {error}',
  toolWriteRootConfigUnderSrc: 'write_file rifiutato: configurazione di root scritta sotto src ({path})',
  toolWriteNoOp: 'Scrittura superflua: {file} era già aggiornato',
  toolWriteError: 'Errore di scrittura: {error}',
  toolWriteUpdated: 'File aggiornato: {file}',
  toolWriteCreated: 'File creato: {file}',
  toolGitStatusDone: 'Stato Git letto in {dir}',
  toolGitStatusError: 'Errore stato Git: {error}',
  toolGitDiffDone: 'Diff Git completato per {target}',
  toolGitDiffError: 'Errore diff Git: {error}',
  toolGitCommitMissingMessage: 'Commit Git non eseguito: messaggio mancante',
  toolGitCommitDone: 'Commit Git creato in {dir}',
  toolGitCommitError: 'Errore commit Git: {error}',
  toolWebSearchDone: 'Ricerca web: {count} risultati',
  toolWebSearchEmpty: 'Ricerca web: nessun risultato per "{query}"',
  toolWebSearchError: 'Errore ricerca web: {error}',
  toolWebFetchDone: 'Contenuto web scaricato',
  toolWebFetchFailed: 'Download contenuto web non riuscito: {error}',
  toolWebFetchError: 'Errore download web: {error}',
  toolTestsNoRunner: 'run_tests: nessun test runner rilevato.',
  toolTestsBlocked: 'Comando di test bloccato: {command}',
  toolTestsPassed: 'Test Run: ✅ {passed}/{total} test superati ({framework}).',
  toolTestsFailed: 'Test Run: ❌ {failed}/{total} test falliti, {passed}/{total} superati ({framework}).',
  toolTestsTimedOut: 'Test Run: tempo scaduto dopo {seconds} secondi.',
  toolTestsUnknownPassed: 'Test Run: comando completato (codice di uscita 0); riepilogo del test non riconosciuto.',
  toolTestsUnknownFailed: 'Test Run: comando fallito (codice di uscita {code}); riepilogo del test non riconosciuto.',
  toolTestsException: 'Errore esecuzione test: {error}',
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
