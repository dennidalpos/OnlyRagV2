# Istruzioni del repository: OnlyRagV2

<!-- secondbrain:repository:begin -->
Direttive comuni applicate: revisione **3.0** — 2026-10-19.
<!-- secondbrain:source global=DC59C089490D9EE3E7E7F389FCC087D199EB12C16ADD2D20EA78076D9BB3BBDB workstation=3090606D3A18890581CDAD79BE8A65348612B40AAF40D5EAEB4E62AE0215D430 -->
Dossier SecondBrain di questo repository: 02-areas/products/OnlyRagV2, relativo alla radice di SecondBrain indicata nelle istruzioni globali.
- Leggi a inizio task: questo AGENTS.md, 02-areas/products/OnlyRagV2/context.md, 02-areas/products/OnlyRagV2/memory.md e PROJECT_STATUS.json (o 02-areas/products/OnlyRagV2/tracker.md).
- Nei task di scrittura aggiorna solo novità pertinenti: decisioni e gotcha in 02-areas/products/OnlyRagV2/memory.md; architettura e stato in 02-areas/products/OnlyRagV2/context.md; attività nel tracker preservandone schema e storico.
- Nei task di scrittura pulisci temporanei del task e residui confermati, preservando dati e lavoro unico; rivedi diff e git status --ignored. Esegui secondbrain.ps1 -Sync dopo modifiche a dossier o direttive, oppure su richiesta. Nei task di sola lettura segnala i residui senza rimuoverli.
<!-- secondbrain:repository:end -->

Revisione specifica del progetto 2.5 — 2026-10-19. Vincoli specifici del progetto; i contenuti comuni sono gestiti separatamente.

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

## Regole di sviluppo

- Tenere aggiornati i test rispetto al comportamento supportato; rimuovere quelli legacy o obsoleti, preservando la copertura delle funzionalità ancora attive e delle regressioni pertinenti.
- Rimuovere codice legacy, shim temporanei e dead code nel perimetro del task, verificando riferimenti e dipendenze e rispettando i vincoli di conservazione dei dati e migrazione esistenti.
- Documentarsi sempre su fonti autorevoli, privilegiando documentazione ufficiale e fonti primarie compatibili con le versioni effettive; citare i riferimenti che sostengono le scelte tecniche.
- Adottare best practice e direttive di sicurezza informatica pertinenti allo stack e al rischio dell'intervento, verificandone l'applicazione ai confini Electron/IPC, Sidecar REST, filesystem e dipendenze.
- In caso di dubbi non risolvibili dai file o dalle fonti, porre domande all'utente prima delle scelte sostanziali; esplicitare le assunzioni a basso rischio e procedere.

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
- 02-areas/products/OnlyRagV2/memory.md e 02-areas/products/OnlyRagV2/context.md (nel dossier SecondBrain) conservano decisioni tecniche durevoli, gotcha e architettura; aggiornarli a fine task.
- Eseguire i controlli previsti per la modifica prima di un commit richiesto. Nessun commit o push automatico.
- Preservare dati persistenti e configurazioni esterne; non estendere la manutenzione a operazioni distruttive non autorizzate.
