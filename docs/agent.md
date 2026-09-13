# Coding Agent

Il ciclo è coordinato da [`agentOrchestratorAppService.ts`](../electron/core/application/agentOrchestratorAppService.ts). Il modello propone; Main autorizza, esegue, verifica e decide la chiusura.

```text
plan/interview -> plan -> collect_context -> propose_action -> apply_action
                                                        -> verify -> outcome
```

## Contratti operativi

- Intervista e piano usano `/api/chat` non streaming con JSON Schema; il loop usa tool nativi o il fallback testuale.
- `AgentPlan` strutturato (`formatVersion: 2`) è eseguibile; il Markdown è solo una vista.
- La policy limita i tool per turno e gate/executor ricontrollano la stessa allowlist.
- Una run di progetto lavora in un worktree o copia temporanea. File, shell, download e package manager non ricevono il path utente.
- Prima dell'esecuzione vengono controllati Ollama, tag esatto, tool calling, contesto minimo, scrivibilità e confinamento. Toolchain assente è un avviso.
- Runtime e checkpoint sono legati alla run; `num_ctx` conserva il limite hardware quando il modello non ne dichiara uno verificato.
- Comandi ed eventi portano `{ runId, conversationId, planRevisionId, workspaceId }`; il Renderer accetta solo la run attiva.
- Timeout e annullamento condividono una `AbortSignal`; la chiusura blocca eventi successivi.
- Cronologia e checkpoint sono distinti. Si riprende solo la stessa run `IN_PROGRESS`; un nuovo prompt riparte con budget nuovi.
- Il contesto editor è il solo `activeFile` (`path`, `content`, `versionHash`); `contextFiles` è rifiutato.
- Coda e stati Ollama sono autorevoli: `queued`, `running`, `cancelling`, `failed`.

## Guardrail

- Una direttiva operativa alla volta previene cicli; i diagnostici privilegiano il primo errore correggibile.
- Le scritture esistenti usano versione letta e compare-and-swap. Le modifiche concorrenti richiedono ricarica, merge o sovrascrittura esplicita.
- Pubblicazione e commit richiedono consenso. Si pubblicano solo path ancora uguali al baseline e il commit include solo path approvati.
- Installazioni, shell e rete sono confinate e autorizzate; symlink/junction fuori workspace e comandi non sicuri sono bloccati.
- Una milestone richiede deliverable ed evidenza coerenti; un esito incerto non viene ritentato automaticamente.

Gli esiti tool sono strutturati (`success`, `failure`, `rejected`, `blocked`); errori incerti non vengono ripetuti automaticamente. La prova comportamentale corrente è descritta in [`verification.md`](./verification.md).
