# Sviluppo locale e test autonomi — 20 ottobre 2026

La decisione del proprietario sostituisce i precedenti obblighi di qualifica: prima l’app Windows funzionante localmente. All’avvio della fase il tracker conteneva **11 task autonomi**, con ID e priorità originali; per il lavoro ancora aperto leggere 02-areas/products/OnlyRagV2/tracker.json (nel dossier SecondBrain) (SecondBrain: `02-areas/products/OnlyRagV2/tracker.json`). **24 task sono ritirati, non completati**. Campagne, ricevute, versioni audit e copie di recupero restano conservate e non riattivano i task ritirati.

## Regole operative attuali

- Nessuna campagna di qualifica, benchmark o certificazione per modello; nessun obbligo di ripeterli quando cambia codice o modello. Le regressioni applicative ordinarie usano risposte e vettori controllati.
- Workflow GitHub Actions rimosso. Suite, gate Python critico, build e smoke Electron restano comandi locali. `test:live` e gli entry point storici di raccolta falliscono prima di avviare campagne; gli strumenti di revisione delle prove restano consultabili.
- Nessuna distribuzione pubblica o nuova migrazione legacy in questa fase. Compatibilità runtime, conservazione degli originali e rifiuto degli archivi incompatibili restano operativi; gli strumenti di manutenzione esistenti non autorizzano operazioni sui dati personali.
- I test autonomi possono usare profili e documenti sintetici, server locali controllati, arresti dei soli processi posseduti e installazioni/disinstallazioni in directory isolate. Non toccano profili personali. Esclusi perdita di alimentazione reale e installazioni di screen reader.
- Accessibilità verificata automaticamente con tastiera, focus, Escape, zoom e albero accessibile. Rete pubblica, campagne OOM/thinking e disponibilità dei servizi esterni non sono gate.

## Smoke facoltativi con i modelli configurati

Le impostazioni vengono lette dal file canonico `%APPDATA%/onlyrag-v2/settings.json` attraverso il decoder applicativo e copiate nel profilo isolato. Sono ammesse solo le assegnazioni salvate per il ruolo richiesto, con contesto, sampling e thinking salvati. Configurazione assente, file illeggibile, modello non installato o servizio indisponibile interrompono la prova: niente download, sostituzioni, modifica delle impostazioni personali o giudizi sul modello.

```powershell
npm run test:models:smoke -- --session-dir "C:/percorso/sessione-di-lavoro" --roles chat,translation,coding,embedding
npm run test:e2e:ingest-translate -- --session-dir "C:/percorso/sessione-di-lavoro"
```

Usare **la stessa directory assoluta per l’intera sessione di lavoro**, anche tra runner diversi, errori e riavvii. Le prenotazioni sono scritte e sincronizzate prima del dispatch: massimo aggregato **4 generazioni, 16 batch embedding, 5 minuti dalla prima apertura**. Una chiamata fallita resta consumata. Nessuna riprova automatica. Il runner desktop passa attraverso il proxy locale che applica gli stessi limiti alle chiamate di Main e Sidecar. Non creare una nuova directory per aggirare un budget esaurito. Un lock lasciato da un arresto anomalo richiede ispezione del proprietario/processo prima del recupero: nessuna cancellazione automatica di lock attivi.

Per questa fase il server Ollama degli smoke deve essere configurato su loopback; se l’app punta a un server remoto la prova si ferma senza cambiare la configurazione. Tutti i test di rete usano servizi locali. Richieste in serie; endpoint di download, creazione o cancellazione di modelli non ammessi. Le cartelle di esecuzione conservano impostazioni isolate e ricevute; hash del file sorgente confrontato dopo la prova.

## Aiuti della UI

Il componente condiviso `Tooltip` legge le chiavi tipizzate `help` nelle traduzioni IT/EN. Spiegazioni e sottotitoli sono disponibili con mouse e tastiera. Etichette, dati, errori, progressi, richieste di decisione e avvisi operativi restano visibili. UI e preflight non mostrano risultati o qualifiche storiche di modelli specifici; rimangono capacità e vincoli runtime.

Il tooltip mantiene il focus sull’attivatore, usa `role="tooltip"` e `aria-describedby`, resta aperto passando il puntatore al testo e si chiude con Escape. Nei modali il layer è interno alla radice attiva e fuori dal pannello scorrevole; il primo Escape chiude l’aiuto e il successivo il modale. Posizione ricalcolata su scroll, resize e zoom, rispettando i bordi del viewport. Riferimenti: [W3C, contenuti su hover/focus](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html), [React, portal](https://react.dev/reference/react-dom/createPortal).

## Verifiche locali

`npm run test`, `npm run quality:python`, `npm run quality:static`, `npm run typecheck`, `npm run docs:check`, `npm run build` e `npm run test:smoke` restano disponibili. `npm run test:tooltips` controlla i componenti reali in Electron con mouse, tastiera, layer, albero accessibile e zoom. Suite complete e prove native si eseguono in una copia isolata con confronto degli hash dei dati primari. Non dedurre installazioni o qualità semantica dal superamento di queste prove.

## Task ritirati per decisione del proprietario

Le voci seguenti escono dal tracker operativo senza dichiarazione di completamento. Il dettaglio precedente rimane nella storia Git e nelle ricevute datate.

- `CI-DEPENDENCY-SCAN-WORKER-DEADLINE-01`
- `CI-CAPABILITY-AUDIT-RETENTION-TIMEOUT-01`
- `DISTRIBUTION-CURRENT-SOURCE-QUALIFICATION-01`
- `CHAT-EFFECTIVE-CONTEXT-ALLOCATION-01`
- `HISTORY-EMBEDDING-CORRECTNESS-01`
- `LEGACY-SESSION-COMPAT-01`
- `DISTRIBUTION-UPDATE-PATH-01`
- `QUALITY-CONTENT-LIVE-QUALIFICATION-01`
- `LOCAL-MODEL-ROLE-QUALIFICATION-01`
- `LIVE-MODEL-HARDWARE-01`
- `AGENT-REQUEST-LEDGER-LIVE-QUALIFICATION-01`
- `TRANSLATION-MARKERS-INSTALLED-01`
- `DISTRIBUTION-COMPONENT-RIGHTS-QUALIFICATION-01`
- `DISTRIBUTION-PUBLIC-SOURCE-DELIVERY-01`
- `QWEN38-FULLTASK-01`
- `RETAINED-RESIDUE-DISPOSAL-01`
- `DEV-AUDIT-HISTORY-RECOVERY-01`
- `RAG-SEMANTIC-RERANKER-QUALIFICATION-01`
- `OLLAMA-RESOURCE-ADMISSION-01`
- `AGENT-SESSION-LIVE-01`
- `AGENT-SKILLS-LIVE-01`
- `AGENT-OOM-LIVE-01`
- `AGENT-THINKING-RUNAWAY-01`
- `I18N-SIDECAR-MIGRATION-LIVE-01`
