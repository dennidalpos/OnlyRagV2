# Coding Agent

Il ciclo è coordinato da [`agentOrchestratorAppService.ts`](../electron/core/application/agentOrchestratorAppService.ts). Il modello propone; Main autorizza, esegue, verifica e decide la chiusura.

```text
complexity check -> [interview -> plan] -> collect_context -> propose_action
                                                     -> apply_action -> verify -> outcome
```

## Contratti operativi

- Intervista e piano usano `/api/chat` non streaming con JSON Schema; il loop usa tool nativi o il fallback testuale.
- L'interfaccia espone una sola azione Esegui e tre modalità: `Ask` è strettamente read-only, `Guided` è il default e richiede revisione delle mutazioni, `Auto` autorizza l'esecuzione locale autonoma. Commit, installazioni e consensi di rete conservano i propri gate.
- La policy del turno riconosce anche richieste colloquiali italiane di creazione (per esempio “fammi un sito”) prima che sia noto un file target: in `Guided` espone la scrittura solo dietro approvazione, mentre le richieste di sola ispezione restano read-only.
- I task complessi entrano automaticamente nel flusso di pianificazione. In `Guided` il piano attende revisione; in `Auto` viene approvato e avviato automaticamente. I task brevi e focalizzati partono direttamente.
- `AgentPlan` strutturato (`formatVersion: 2`) è eseguibile; il Markdown è solo una vista.
- La policy limita i tool per turno e gate/executor ricontrollano la stessa allowlist.
- Una run di progetto lavora in un worktree o copia temporanea. File, shell, download e package manager non ricevono il path utente.
- Lo standalone usa `userData/agent-scratch`: è persistente tra sessioni, visibile nell'esplora-file e dispone di Mostra, Esporta e Svuota. Main ribinda ogni run standalone a questo path autorevole; una run di progetto senza workspace esplicito viene rifiutata, senza fallback alla directory di installazione o a `process.cwd()`. Al primo accesso la cronologia standalone precedente viene migrata nel nuovo store.
- Prima dell'esecuzione vengono controllati Ollama, tag esatto, tool calling, contesto minimo, scrivibilità e confinamento. Toolchain assente è un avviso.
- Runtime e checkpoint sono legati alla run; `num_ctx` conserva il limite hardware quando il modello non ne dichiara uno verificato.
- Il misuratore `Ctx` mostra il prompt realmente composto da Main: token BPE, budget prompt, riserva di risposta e finestra del modello. Non deriva più il valore dai messaggi visibili nel Renderer.
- Il setup salva una finestra per ogni modello generativo scelto usando il limite sicuro dell'hardware; Main la limita anche al massimo dichiarato dal modello. Intervista, piano e turni operativi calcolano `num_predict` dallo spazio realmente libero dopo il prompt, senza cap fissi per fase. Un retry per `length` parte solo se puo ampliare davvero il budget.
- Le preferenze Thinking sono salvate separatamente per modello e partono disattivate. Il toggle richiede un alias installato esatto con capability `thinking` e supporto binario; per gli altri modelli Main invia `think:false`, che alcuni modelli a livelli possono ignorare.
- Nelle schede dei modelli installati il toggle Thinking appare solo per una scelta binaria reale. GPT-OSS, regolabile solo per livelli e non disattivabile, mostra invece una nota di compatibilità.
- La scelta effettiva passa come campo Ollama `think` nei percorsi chat, traduzione, intervista, piano e turni Agent Coding. I trasporti leggono `thinking` separatamente dal contenuto finale, così tracce di ragionamento non entrano nei parser JSON o delle chiamate tool. Il Sidecar usa lo stesso campo per traduzione documenti e normalizzazione LLM opzionale.
- `Compact` abilita la compattazione aggressiva del prompt backend, riduce lo storico operativo inviato al modello e invalida il riuso KV; la timeline di audit resta completa e viene persistita senza eliminazioni.
- Il log audit dell'agente è disattivato per impostazione predefinita. Quando attivo salva solo metadati, dimensioni e hash; prompt, path, sorgenti, parametri, output e diff richiedono l'opt-in subordinato **Includi prompt e sorgenti** nella stessa scheda. La preferenza rimane salvata se il log viene spento, ma non ha effetto finché il log è disattivato. L'opt-in riguarda solo audit Coding Agent e bundle diagnostici. Dinieghi della policy tool e generazioni piano fallite o senza milestone sono registrati come esiti falliti.
- Impostazioni consente di conservare da 1 a 5 generazioni del log e di pulire subito file attivo e rotazioni. Anche il debug bundle omette i payload se l'opt-in non è attivo.
- Comandi ed eventi portano `{ runId, conversationId, planRevisionId, workspaceId }`; il Renderer accetta solo la run attiva.
- Timeout e annullamento condividono una `AbortSignal`; la chiusura blocca eventi successivi.
- Al termine, la timeline mostra una scheda di evidenze persistita con file modificati, ultima verifica applicativa, stato del rollback in caso di annullamento ed eventuali effetti esterni non coperti dal journal.
- Cronologia e checkpoint sono distinti. Si riprende solo la stessa run `IN_PROGRESS`; un nuovo prompt riparte con budget nuovi.
- Il contesto editor è il solo `activeFile` (`path`, `content`, `versionHash`); `contextFiles` è rifiutato.
- Coda e stati Ollama sono autorevoli: `queued`, `running`, `cancelling`, `failed`.

## Guardrail

- Una direttiva operativa alla volta previene cicli; i diagnostici privilegiano il primo errore correggibile.
- Le scritture esistenti usano versione letta e compare-and-swap. Le modifiche concorrenti richiedono ricarica, merge o sovrascrittura esplicita.
- Pubblicazione e commit richiedono consenso. Si pubblicano solo path ancora uguali al baseline e il commit include solo path approvati; i metadati runtime `.onlyrag` non entrano nell’anteprima né nella pubblicazione.
- Installazioni, shell e rete sono confinate e autorizzate; symlink/junction fuori workspace e comandi non sicuri sono bloccati.
- I comandi Git distruttivi (`reset --hard`, `clean -f`, ripristino/checkout globale, force-push e cancellazione branch) sono bloccati, non delegati alla sola approvazione.
- Una milestone richiede deliverable ed evidenza coerenti; un esito incerto non viene ritentato automaticamente.

Gli esiti tool sono strutturati (`success`, `failure`, `rejected`, `blocked`); errori incerti non vengono ripetuti automaticamente. La prova comportamentale corrente è descritta in [`verification.md`](./verification.md).
