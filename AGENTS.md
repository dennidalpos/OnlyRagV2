# Istruzioni del repository: OnlyRagV2

<!-- secondbrain:repository:begin -->
Direttive comuni applicate: revisione **4.0** — 2026-10-29. <!-- secondbrain:source global=7585B84CED201216722B7E6646C3D2845045FEEE7E44C889E92E68A5E1975A4A workstation=2BC7FB0217FB690B8CEAB7E3DD85AAB916BA4CF3016533BC9E1D02477CE9321B -->SecondBrain: integrazione opzionale della conoscenza e delle direttive comuni. Risolvi SECONDBRAIN_HOME dallʼambiente utente della postazione; nessun percorso personale è conservato in questo repository. Se il clone privato non è disponibile, prosegui con le istruzioni tecniche locali e segnala lʼintegrazione non configurata; non creare memorie o stub sostitutivi. Dal clone SecondBrain usa scripts/prompts.ps1 -Context -RepositoryPath <checkout-corrente> per risolvere il dossier e il suo index.md. Carica indice, contesto sintetico, memoria essenziale e proiezione task pertinente; approfondimenti e storico soltanto quando servono. Memorie private, tracker interni, backup e output operativi risiedono in SecondBrain. Conserva qui codice, guide e asset pubblicabili. Le direttive non autorizzano commit, push, cancellazioni di artefatti o task applicativi impliciti.
<!-- secondbrain:repository:end -->

Revisione specifica del progetto 2.8 — 2026-10-25. Vincoli specifici del progetto; i contenuti comuni sono gestiti separatamente.

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

Comandi verificati staticamente contro i file del progetto; questa revisione delle direttive non certifica l'esecuzione di build o test applicativi. I controlli sono locali; workflow CI e qualifiche dei modelli sono ritirati in questa fase.

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
- Tracker autorevole nel dossier SecondBrain: `02-areas/products/OnlyRagV2/tracker.json`, dichiarato in repository.json. Conservare schema JSON v1 e storico; build e test restano indipendenti da SecondBrain.
- 02-areas/products/OnlyRagV2/memory.md e 02-areas/products/OnlyRagV2/context.md (nel dossier SecondBrain) conservano decisioni tecniche durevoli, gotcha e architettura; aggiornarli a fine task.
- Eseguire i controlli previsti per la modifica prima di un commit richiesto. Nessun commit o push automatico.
- Preservare dati persistenti e configurazioni esterne; non estendere la manutenzione a operazioni distruttive non autorizzate.

## Sviluppo locale e test autonomi — 2026-10-20

- Il proprietario ha ritirato qualifiche/benchmark dei modelli, campagne live, obblighi CI, distribuzione pubblica e nuove migrazioni legacy. Il backlog iniziale di questa fase conteneva 11 task autonomi; lo stato corrente è in 02-areas/products/OnlyRagV2/tracker.json. Le ricevute storiche restano consultabili e non riattivano obblighi ritirati.
- I test ordinari sono deterministici. Per smoke funzionali facoltativi usare esclusivamente host, ruoli e opzioni salvati manualmente nell'app, con impostazioni copiate in un profilo isolato; mai scaricare, sostituire modelli o modificare impostazioni personali.
- Limite aggregato per sessione di lavoro: 4 generazioni, 16 batch embedding e 5 minuti, inclusi errori e riprove. Riutilizzare la stessa directory di sessione tra invocazioni; contatori e tentativi non si azzerano per riavviare un runner o proseguire questo task. `npm run test:models:smoke -- --session-dir <percorso-assoluto-condiviso> --roles chat,translation,coding,embedding`. Un ruolo mancante interrompe la prova.
- Sono autorizzati profili e documenti sintetici, crash dei soli processi posseduti e installazione/disinstallazione in directory isolate. Per rete usare server locali controllati. Dati personali, perdita di alimentazione reale e installazioni di screen reader sono esclusi.
- Gli aiuti della UI usano il componente Tooltip e il catalogo i18n help condivisi; etichette, errori, stati operativi e decisioni restano visibili. Accessibilità verificata automaticamente con tastiera, focus, zoom e albero accessibile.
- Non cancellare prove storiche, backup o dati legacy incompatibili. La rimozione dei relativi task non autorizza lo smaltimento dei file o la rimozione delle protezioni runtime.
