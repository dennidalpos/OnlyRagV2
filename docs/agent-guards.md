# Guard del Coding Agent

Le regole effettive sono in [`agentProgressPolicy.ts`](../electron/core/domain/agent/agentProgressPolicy.ts), [`loopDetector.ts`](../electron/core/domain/agent/loopDetector.ts), [`agentOrchestratorToolGates.ts`](../electron/core/application/agentOrchestratorToolGates.ts) e [`commandSecurity.ts`](../electron/core/domain/agent/commandSecurity.ts). I valori numerici vanno letti da `PROGRESS_BUDGET`, non copiati in una seconda tabella.

## Politica di progresso (`agentProgressPolicy.ts`)

Schema non valido, errori ripetuti, richieste senza tool e step senza mutazioni consumano budget distinti. Una verifica identica fallita senza modifiche è bloccata subito; una verifica dopo una modifica può essere riprovata. Guard e loop detector registrano motivo, azione e step. Una chiusura forzata non diventa `verified` per il solo testo del modello e conserva le modifiche già fatte nel workspace.

## Tracciamento eventi e chiusure

Gli eventi sono legati alla run. Stop, annullamento e rifiuto di una policy non ripristinano automaticamente checkpoint. Un esito di verifica richiede un comando effettivo e un risultato riconducibile al progetto corrente.

## Verifica dei progetti nativi

Il resolver usa manifest e configurazioni osservati per Python/pytest, Go, Cargo, Maven, Gradle e gli script test Composer. Tutti gli stack riconosciuti nella stessa directory devono avere un controllo; Node non certifica uno stack nativo privo di comando. Strumenti assenti restano `unverifiable`; errori, timeout e annullamento conservano il rispettivo esito. Le opzioni offline evitano il provisioning implicito, senza costituire una sandbox di rete degli script. Il wrapper imposta temporaneamente sia `npm_config_offline=true` sia `pnpm_config_offline=true`: pnpm 12 richiede il proprio prefisso anche per le dipendenze di configurazione del package manager. Ambiente e directory sono ripristinati dopo successo o errore; un pin non preparato viene rifiutato. [Prova nativa pnpm](./verification-security-lot-2026-10-25.md), [comandi e qualifica degli altri stack](./verification-native-projects-2026-10-19.md).

## Consigli e ordini

La diagnostica produce `DiagnosticAdvice`; il risultato di un tool lo presenta come consiglio. Solo [`planDirectiveArbiter.ts`](../electron/core/domain/agent/planDirectiveArbiter.ts) decide l'ordine del turno. [`orderAuthority.test.ts`](../electron/core/domain/agent/orderAuthority.test.ts) protegge questa distinzione.

## Compare-and-swap e integrità file

Una modifica a un file esistente richiede l'hash della versione letta. Un edit esterno fa rifiutare la scrittura finché il file non viene riletto. I checkpoint sono limitati ai file attribuiti alla run; `.onlyrag` non è un deliverable ripristinabile.

## Sicurezza comandi e filesystem

Il profilo ordinario applica controlli di percorso, comando, rete, installazione e approvazione. `fullAccess` in Guided/Auto salta i gate contestuali dell'app e amplia i percorsi ammessi; Ask rimane sola lettura. Il ramo `fullAccess` passa prima di `checkCommandSecurity`, quindi non attribuirgli le esclusioni dei comandi del profilo ordinario; restano i limiti del sistema operativo e dei singoli tool. Risultati e limiti di qualifica sono in [`coding-agent.md`](./coding-agent.md) e nel `tracker` (SecondBrain: `02-areas/products/OnlyRagV2/tracker.json`).
