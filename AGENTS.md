# Istruzioni del repository: OnlyRagV2

Revisione 2.4 — 2026-10-18. Vincoli specifici del progetto; i contenuti comuni sono gestiti separatamente.

## Contesto

- **Scopo**: Applicazione desktop locale per Windows per ingestione documenti, ricerca RAG offline, traduzione e workflow con Coding Agent.
- **Modalità**: Greenfield (semplificazione aggressiva per architettura minimale; eliminazione shim temporanei e dead code)
- **Target Applicativo**: Desktop Windows con Electron e interfaccia per desktop 1080p, Sidecar REST locale e CLI di manutenzione.
- **Stack & Toolchain**: TypeScript, React, Vite, Electron, Python 3.13 / FastAPI, LanceDB, npm, Vitest, pytest e PowerShell (`pwsh`).

## Vincoli specifici

  * Validazione rigorosa degli input ai confini dell'applicazione (schema runtime e Zod per contratti IPC).
  * Interfaccia per desktop Windows 1080p; tablet e smartphone sono fuori dal target applicativo.
  * Isolamento Renderer / Main process tramite Electron Preload e IPC tipizzato (`shared/ipc/ipcContract.ts`).
  * LanceDB locale e runtime Ollama locale per elaborazione documenti in totale privacy offline.

## Comandi e verifica

Comandi verificati staticamente contro i file del progetto; questa revisione delle direttive non certifica l'esecuzione di build o test applicativi. Consultare anche i gate della CI, quando presenti.

| Attività | Comando | Ambiente | Evidenza e limiti |
|---|---|---|---|
| **Install** | `npm install` | pwsh / root | Setup dipendenze frontend |
| **Setup Dev** | `npm run setup:dev` | pwsh / root | Configurazione ambiente completo (Node + venv Python) |
| **Dev** | `npm run dev` | pwsh / root | Server di sviluppo locale con hot reload |
| **Targeted checks** | `npx vitest run <percorso>` | pwsh / root | Test rapidi mirati all'ambito modificato |
| **Python critical paths** | `npm run quality:python` | pwsh / root | Gate offline su ammissione, ricerca e persistenza; rifiuta controlli mancanti o saltati |
| **Full checks** | `npm run test && pytest` | pwsh / root | **Gate obbligatorio pre-commit** (test completi frontend e backend) |

## Riferimenti e collaborazione

- Consultare README e documentazione effettivamente presenti; versioni dai manifest/lockfile, non da ipotesi sullo stack.
- PROJECT_STATUS.json è il tracker esistente: contiene lavoro aperto, senza storico dei task conclusi; preservarne lo schema.
- repos/OnlyRagV2/memory.md e repos/OnlyRagV2/context.md (nel dossier SecondBrain) conservano decisioni tecniche durevoli, gotcha e architettura; aggiornarli a fine task.
- Eseguire i controlli previsti per la modifica prima di un commit richiesto. Nessun commit o push automatico.
- Preservare dati persistenti e configurazioni esterne; non estendere la manutenzione a operazioni distruttive non autorizzate.

<!-- secondbrain:repository:begin -->
Dossier SecondBrain di questo repository: repos/OnlyRagV2, relativo alla radice di SecondBrain indicata nelle istruzioni globali.
- Leggi a inizio task: questo AGENTS.md, repos/OnlyRagV2/context.md, repos/OnlyRagV2/memory.md e PROJECT_STATUS.json (o repos/OnlyRagV2/tracker.md).
- Nei task di scrittura aggiorna solo novità pertinenti: decisioni e gotcha in repos/OnlyRagV2/memory.md; architettura e stato in repos/OnlyRagV2/context.md; attività nel tracker preservandone schema e storico.
- Nei task di scrittura pulisci temporanei del task e residui confermati, preservando dati e lavoro unico; rivedi diff e git status --ignored. Esegui secondbrain.ps1 -Sync dopo modifiche a dossier o direttive, oppure su richiesta. Nei task di sola lettura segnala i residui senza rimuoverli.
<!-- secondbrain:repository:end -->
