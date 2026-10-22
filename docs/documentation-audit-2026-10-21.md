# Riesame della documentazione — 21 ottobre 2026

> **Aggiornamento del 22 ottobre 2026:** i due rilievi statici segnalati qui sotto su *Etichette OCR* (`INGESTION-OCR-PROVIDER-LABEL-01`) e *Wrapper test Sidecar* (`TEST-SIDECAR-DETERMINISTIC-WRAPPER-01`) sono stati risolti e verificati nel [lotto del tracker del 22 ottobre](./verification-tracker-lot-2026-10-22.md); resta tracciato in [PROJECT_STATUS.json](../PROJECT_STATUS.json) il limite sul provider disponibile vs effettivo dopo fallback CPU (`OCR-RUNTIME-EFFECTIVE-PROVIDER-01`). Questo documento conserva il resoconto del 21 ottobre.

## Perimetro e criterio

Confrontati README, direttive specifiche, guide correnti per ambito, indici, skill, diagrammi della guida e README dei corpus con decisioni approvate, tracker, manifest, contratti e punti di ingresso del codice. Gli 84 rapporti storici, proposte, indici di ancoraggi e consegne sono censiti nell'[indice storico](./history.md): i loro risultati non vengono ricalcolati o presentati come prove del runtime corrente. Licenze, corpus congelati, ricevute JSON e snapshot restano conservati.

Il comportamento previsto deriva dalle direttive e dalle decisioni esplicite; contratti e implementazione descrivono ciò che il programma fa. Il confronto non assume che il codice abbia ragione quando diverge dalla decisione. Le modifiche sono documentali: nessun fix applicativo, installazione, inferenza, operazione su dati personali, commit o push.

## Aggiornamenti applicati

| Ambito | Correzione e riscontro |
| --- | --- |
| Consultazione | [Indice delle guide](./README.md) essenziale, [verifica corrente](./verification-current.md) sintetica e [indice storico](./history.md) per ambito. La precedente verifica corrente è conservata integralmente nei [riepiloghi storici](./verification-summary-history-2026-10-21.md); gli ancoraggi usati dai vecchi rapporti restano raggiungibili. |
| Requisiti e tracker | La revisione specifica 2.7 di [AGENTS.md](../AGENTS.md) qualifica come iniziali gli 11 task del 20 ottobre; lo stato aperto rimane nel tracker. Nessun blocco SecondBrain gestito riscritto a mano. Ritirati e conclusi non vengono assimilati: rimossi dalle guide i falsi task ancora aperti su impostazioni, XLS, riconciliazione e campagne live. |
| Comandi | [Operazioni](./operations.md): gate pre-commit frontend+Python coerente con AGENTS, distinzione runtime/dev requirements, effetti di setup/build/packaging/OpenAPI/cleanup, limiti del wrapper Sidecar. `test:fast` cambia il reporter, non seleziona una suite ridotta. |
| IPC/REST | [IPC](./api-ipc.md) rinvia all'enumerazione reale invece di duplicarla; [REST](./api-rest.md) distingue token, preflight OPTIONS, rifiuto dei campi extra e task ID opzionale nel REST ma obbligatorio nel client streaming dell'app. Riscontro su `ipcContract.ts`, `sidecarHttpClient.ts`, `main.py` e `schemas.py`. |
| Interfaccia | [Guida utente](./guida-utente.md): scarto confermato della bozza, export Markdown oltre soglia, avvio Sidecar, chiusura wizard senza salvataggio, cancellazione prima del primo evento e all'unmount, output PDF/DOCX, export dello storico dalla memoria e baseline Informazioni. Aggiornata solo la descrizione accessibile del diagramma 13; geometria e testi visibili invariati. |
| Persistenza | [Frontend](./frontend.md), [Main](./electron-main.md) e [ingestion](./ingestion.md) distinguono i completamenti con ricevuta da perdita di alimentazione e build diverse; niente nuovi obblighi installati dedotti da vecchi rapporti. |
| Ricerca/manutenzione | [Ricerca](./retrieval.md) chiarisce che `prepare` chiama l'encoder e che il ritiro della campagna non risolve i risultati negativi. CLI e requisiti restano quelli del codice; nessun nuovo rebuild eseguito. |
| Coding Agent | [Architettura](./architecture.md) distingue avvio diretto e pianificazione esplicita. [Uso](./coding-agent.md), [runtime](./agent-runtime.md) e [diagnostica](./agent-diagnostics.md) includono ispezione/abbandono senza replay e qualificano come storici i gate ritirati; i controlli del profilo ordinario non vengono attribuiti a fullAccess. |
| Dipendenze | [Librerie](./libraries.md) separa baseline locale, rimedi conclusi e registro storico. I riesami del 15/19 ottobre sono conservati nel [registro](./libraries-history-2026-10-13.md), con rinvii dagli ancoraggi precedenti. Nessuna nuova affermazione su ultima release upstream o alert remoti. |
| Distribuzione | [Candidati locali](./distribution.md) descrive comandi ed effetti senza eleggere un vecchio installer a candidato corrente. Proposta AGPL, registro CPU e riesame licenze conservano decisioni/hash e qualificano temporalmente i vecchi gate. README distingue pubblicazione dei sorgenti e consegna installer. I testi delle licenze non sono cambiati. |
| Modelli/corpus | [Baselines](./model-task-baselines.md), [accettazione](./content-acceptance.md) e [piano lingua](./plan-chat-language-2026-10-20.md) sono documenti storici, senza riattivazione di campagne o vecchi budget. La stima [runtime fit](./model-runtime-fit.md) mantiene il comportamento informativo verificato nel codice e separa i replay datati. README distingue diagnostica hardware e assegnazioni esplicite: il catalogo iniziale non seleziona i modelli in base all'hardware. Il README dei corpus non invita a nuove raccolte. |

Le nove skill gia aggiornate nella precedente fase sono preservate; questo lotto non le riscrive. I vecchi indici `verification.md` e `rag-sidecar.md` rimangono ponti agli ancoraggi storici, necessari ai riferimenti esistenti. Eliminati i riepiloghi operativi duplicati dagli indici correnti; nessun rapporto unico, fallimento, backup o dato legacy eliminato.

## Discrepanze residue

| Rilievo | Atteso, osservato e limite |
| --- | --- |
| Etichette OCR | Il provider effettivo dipende da runtime/hardware, e la UI deve comunicarlo senza promettere GPU. In [useIngestion.ts](../src/hooks/useIngestion.ts) i testi iniziali contengono ancora `CUDA nativo` nel ramo OCR nativo. La guida mantiene la distinzione corretta; è una discrepanza statica del prodotto, non corretta qui. Non riprodotta su una nuova ingestione CPU reale in questa sessione. |
| Wrapper test Sidecar | I test ordinari devono essere deterministici secondo AGENTS. [test_sidecar_health.ps1](../scripts/test_sidecar_health.ps1) sceglie invece richieste live quando risponde la porta 8000, senza header launch-token, ed esce senza pytest; solo il ramo offline esegue la suite. Documentato il limite e indicato pytest diretto. Nessun servizio personale interrogato per riprodurlo. |
| Ambiente Python corrente | `.venv/Scripts/python.exe -m pytest --version` fallisce con `No module named pytest`. Le dipendenze runtime non equivalgono ai requisiti dev. Nessuna installazione automatica; il gate completo non è verificato da questo lavoro. |
| Verifiche esterne/datate | Modelli, alert remoti, asset dei vecchi installer, percorsi esterni delle campagne e corrispondenza completa dei sorgenti distribuiti non sono riletti integralmente. Restano le ricevute originali, senza attribuire loro freschezza o qualifica generale. I diritti dei componenti non sono rivalutati da questa revisione documentale. |

I due P2 originali del tracker conservano ID, priorità e criteri. I rilievi statici sopra sono segnalazioni di questo riesame, non correzioni applicative o task storici riattivati.

## Verifiche della sessione

| Comando / controllo | Esito e limite |
| --- | --- |
| `npm run docs:check` | Passato su 119 file Markdown: link locali, ancoraggi e nomi degli script npm, incluse skill e README dei corpus. Non è un controllo generale di URL esterni o semantica. |
| `npm run format:check` | Controllo whitespace del diff; risultato finale verificato prima della consegna. |
| `npm run quality:static` | Passato: 888 file, 107 handler IPC, regole di layering e formattazione; nessuna correzione automatica. |
| `npm run assets:check` | Passato: PNG 512 e ICO 16/32/48/64/128/256. Il generatore dell'app non produce i diagrammi della guida. |
| Vitest mirato | 67 test in otto file, tutti passati: validatore, modello configurato, runtime fit, ingestion e native file, traduzione e ownership, writer atomico. Sei test del validatore passati anche prima delle modifiche. |
| Python standard library, senza import Sidecar | AST dei decorator REST e OpenAPI coincidono su 15 operazioni; 26 SVG XML validi con titolo/descrizione accessibili; hash di `ragged.xls` uguale al README. Parita di route non prova l'intero schema runtime. |
| Manifest/lock locali | Versioni rilette per React, Electron, Vite, Vitest, Monaco, DOMPurify e braces: lock e pacchetti installati coincidono. Non e un audit sicurezza nuovo. |
| Preservazione | Confronto con backup SHA-256 esterno al checkout: corpus/JSON/notice/font/licenze e blocco gestito AGENTS invariati; testo precedente di verifica correntè conservato integralmente; modifiche skill preesistenti preservate. |

Comando Vitest eseguito dalla radice:

```powershell
npx vitest run scripts/validate_documentation.test.mts shared/domain/settings/configuredModel.test.ts shared/domain/hardware/modelRuntimeFit.test.ts src/hooks/useIngestion.test.ts src/hooks/useIngestionNativeFile.test.tsx src/hooks/useTranslation.test.ts src/hooks/useTranslationOwnership.test.tsx electron/core/infrastructure/filesystem/safeAtomicFileWriter.test.ts
```

Setup, dev, build, installer, test live/Sidecar, smoke con modelli, cleanup reale e rigenerazione OpenAPI non sono eseguiti per questo intervento. Parametri ed effetti sono confrontati con gli script; le suite complete non sono ripetute per modifiche documentali. Non e una qualifica pre-commit, installata o semantica.

Fonti primarie di riscontro: [isolamento e sicurezza Electron](https://www.electronjs.org/docs/latest/tutorial/security), [Python 3.13 e hard link](https://docs.python.org/3.13/library/os.html#os.link), [ambienti Vitest](https://vitest.dev/guide/environment.html). Queste pagine spiegano i meccanismi; la compatibilità delle versioni coinvolte e confrontata con sorgenti/config locali, non dedotta dalla sola documentazione latest.
