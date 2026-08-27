# Contesto del repository

Compila questo file usando solo fatti verificati nel repository corrente o confermati dall’utente. Usa `Non verificato` quando un dato è sconosciuto. Non inserire mai valori segreti.

## Identità e stato

- **Nome:** OnlyRag V2
- **Scopo:** Workspace desktop AI locale e studio di coding agent, secondo README.md.
- **Tipo di progetto:** Applicazione desktop Electron con frontend React/Vite e sidecar Python.
- **Utenti:** Non verificato.
- **Radice del repository:** `D:\GITHUB\OnlyRagV2`
- **Stato del repository:** Wave 1 completata localmente; modifiche non committate presenti.
- **Branch corrente:** `master`
- **Working tree:** Dirty; modifiche e file non tracciati relativi alla Wave 1.
- **Controllo versione:** Git
- **Remote:** `https://github.com/dennidalpos/OnlyRagV2.git`
- **Ispezionato il:** 2026-08-27

## Obiettivi e vincoli

- **Obiettivi esclusi:** Wave 2 e successive, fino a una richiesta esplicita di implementazione.
- **Vincoli confermati:** Preservare modifiche non correlate; non committare, fare push o modificare dati esterni senza conferma.
- **Assunzioni:** La prossima attività prevista dal tracker è W2.01.
- **Evidenze:** `PROJECT_STATUS.json`, `README.md`, `docs/architecture.md`, output di `git status`, test e build eseguiti il 2026-08-27.

## Ambiente

- **Sistema operativo e versione:** Microsoft Windows 11 Pro 10.0.26200
- **Architettura:** AMD64
- **Shell e versione:** PowerShell 7.6.5
- **IDE e modalità istruzioni:** Codex desktop, istruzioni repository in questo file
- **Locale:** it-IT
- **Rete necessaria:** Non verificato; alcuni test usano client/adapter di rete con fallback.
- **Container runtime:** Non verificato.
- **Nomi delle variabili d’ambiente richieste:** `OLLAMA_MODELS` è opzionale nel codice diagnostico; elenco completo non verificato.
- **Nomi delle chiavi segrete richieste:** Non verificato; nessun valore segreto registrato.

## Runtime e strumenti

- **Linguaggi e versioni:** TypeScript/JavaScript; Python presente per il sidecar, versione non verificata.
- **Runtime:** Node.js v24.20.0; Electron; Python sidecar.
- **Package manager e versione:** npm 11.19.0
- **File con versioni bloccate:** `.nvmrc`, `.python-version`, `package-lock.json`
- **Strumenti obbligatori:** Node.js 24.x, npm 11.x, TypeScript, Vite, Vitest, PowerShell.
- **Strumenti opzionali:** Ollama e componenti sidecar/live test.
- **Installazioni locali vietate:** Installazioni globali non richieste.
- **Note di configurazione:** `package.json` richiede Node `>=24.19.0 <25` e npm `>=11 <12`.

## Comandi verificati

Registra solo comandi realmente eseguiti con successo. Indica directory di esecuzione, shell, data, risultato e varianti per piattaforma.

| Scopo | Comando | Shell | Directory | Verificato il | Risultato | Note |
|---|---|---|---|---|---|---|
| Setup | Non eseguito in questa ispezione | PowerShell | `D:\GITHUB\OnlyRagV2` | 2026-08-27 | Non applicabile | Dipendenze già presenti. |
| Sviluppo | Non eseguito | PowerShell | `D:\GITHUB\OnlyRagV2` | 2026-08-27 | Non applicabile | — |
| Test rapidi | `npm run test:unit -- ...Wave 1 test files...` | PowerShell | `D:\GITHUB\OnlyRagV2` | 2026-08-27 | Passato: 6 file, 30 test | — |
| Test completi | `npm run test:fast` (invocato dal lint runner) | PowerShell | `D:\GITHUB\OnlyRagV2` | 2026-08-27 | Passato: 184 file, 1660 test | — |
| Singolo test | Non eseguito | PowerShell | `D:\GITHUB\OnlyRagV2` | 2026-08-27 | Non applicabile | — |
| Lint / formattazione | `npm run lint`; `npm run format:check` | PowerShell | `D:\GITHUB\OnlyRagV2` | 2026-08-27 | Passato | Il lint runner ha completato anche test, build e smoke. |
| Type-check | `npm run typecheck` | PowerShell | `D:\GITHUB\OnlyRagV2` | 2026-08-27 | Passato | — |
| Build | `npm run build` (invocato dal lint runner) | PowerShell | `D:\GITHUB\OnlyRagV2` | 2026-08-27 | Passato | Smoke test Electron passato. |
| Personalizzato | `npm run docs:check` (invocato dal lint runner) | PowerShell | `D:\GITHUB\OnlyRagV2` | 2026-08-27 | Passato | 10 Markdown verificati. |

## Struttura del repository

- **Entry point principali:** `src/main.tsx`, `electron/main.ts`, sidecar Python indicato in `README.md`.
- **Percorsi importanti:** `src/`, `electron/`, `sidecar/`, `docs/`, `scripts/`.
- **Percorsi generati:** `dist/`, `dist-electron/`, `coverage/`, `build/`, `sidecar_dist/`; rigenerare, non modificare manualmente.
- **Percorsi da non modificare:** Non verificato.
- **Percorsi dei test:** Test `*.test.ts`/`*.test.mts` accanto ai moduli.
- **Percorsi della documentazione:** `README.md`, `docs/`.
- **Percorsi di configurazione:** `package.json`, `tsconfig.json`, `vite.config.mts`, `vitest*.mts`, `sidecar.spec`.

## Architettura locale

- **Stile architetturale rilevato:** Clean Architecture/layered, documentata in `docs/architecture.md`.
- **Livelli presenti:** Presentazione, applicazione, dominio, infrastruttura; frontend Electron e sidecar separati.
- **Direzione delle dipendenze:** Presentazione → applicazione → dominio → infrastruttura.
- **Confini tra moduli:** IPC Electron, servizi applicativi, contratti dominio e repository/adapter infrastrutturali.
- **Interfacce pubbliche:** IPC `window.electronAPI`, API sidecar e contratti TypeScript/Zod.
- **Direttive locali:** Questo file e `PROJECT_STATUS.json`.
- **Ambito di applicazione:** Repository `D:\GITHUB\OnlyRagV2`.

## Convenzioni del progetto

- **Nomi:** Non formalizzato oltre alle convenzioni esistenti dei moduli.
- **Formattazione:** Verificata con `npm run format:check`.
- **Gestione degli errori:** Logging strutturato e fallback espliciti; evitare catch vuoti.
- **Configurazione:** `package.json` e file di configurazione root.
- **Logging:** Diagnostica e audit redatti; retention audit limitata.
- **Test:** Vitest; test collocati vicino al codice.
- **Dipendenze:** Usare quelle già presenti e rispettare `package-lock.json`.
- **Commit:** Non eseguito; working tree da revisionare e confermare prima del commit.
- **Lingua del codice e della documentazione:** Codice prevalentemente inglese, documentazione mista italiano/inglese.

## Rischi, eccezioni e documentazione

- **Aree sensibili:** Persistenza `.onlyrag`, esecuzione processi, rete/download, logging e rollback workspace.
- **Problemi noti o gotcha:** I controlli completi possono richiedere oltre due minuti; alcuni test emettono warning/fallback di rete non bloccanti.
- **Skill o strumenti specifici del repository:** Script npm in `package.json`, script PowerShell in `scripts/`.
- **Skill o strumenti mancanti:** Non verificato.
- **Fonti autorevoli:** `docs/`, `README.md`, `package.json`, codice e test del repository.
- **Eventi che richiedono aggiornamento della documentazione:** Cambi architetturali, contratti IPC, policy di sicurezza o comandi di verifica.
- **Elementi ancora sconosciuti:** Utenti target, container runtime, inventario completo env/secret, policy commit.

## Tracker del lavoro

- **Percorso:** `PROJECT_STATUS.json`
- **Formato:** JSON
- **Schema:** Oggetto con array `todos` di stringhe `Wn.nn | descrizione`.
- **Creazione automatica:** No, salvo richiesta esplicita.
- **Tracciare solo lavoro pendente:** Sì.
- **Posizione della cronologia:**
- **Regole locali:** Tracciare solo lavoro pendente; non creare tracker aggiuntivi salvo richiesta.

## Verifica

- **Baseline raccolta il:** 2026-08-27, `git status`, diff e struttura repository.
- **Controlli applicabili:** Test mirati Wave 1, suite, typecheck, lint/format, docs check, build Electron e smoke test.
- **Controlli eseguiti e risultati:** Tutti passati; 30 test mirati e 1.660 test completi.
- **Fallimenti preesistenti:** Nessuno osservato nei controlli eseguiti.
- **Controlli non disponibili e motivi:** Live/sidecar non eseguiti in questa attività.
- **Test instabili o messi in quarantena:** Nessuno.
- **Ultima verifica completa:** 2026-08-27.

## Completamento

- **Compilato da:** Codex
- **Compilato il:** 2026-08-27
- **Verificato contro il repository:** Sì
- **Segnaposto ancora presenti:** Sì, dove il repository non fornisce evidenza.
- **Eccezioni confermate dall’utente:** Nessuna.
- **Ultima revisione:** 2026-08-27
