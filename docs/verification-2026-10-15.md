# Verifica locale del 15 ottobre 2026

Ricevuta della chiusura di sessione su `master`. Il perimetro comprende la guida utente, memoria e tracker, le direttive aggiornate e le modifiche locali preesistenti a DNS, redirect dei download e test di recupero/provenienza, incluse su richiesta esplicita dell'utente.

## Controlli

| Comando | Exit code | Esito |
| --- | --- | --- |
| `npm run test -- --silent=true` — primo passaggio | 1 | 2.717 test superati e uno fallito, in 313 file. Il test della preview Vite ha rilevato la porta assegnata raggiungibile su `127.0.0.2` invece del solo `127.0.0.1`. |
| `npx vitest run electron/core/infrastructure/process/managedDevServerRepository.test.ts` | 0 | Tutti e cinque i test superati senza modifiche al codice o riduzione dei controlli. |
| `npm run test -- --silent=true` — secondo passaggio completo | 0 | 2.718 test superati in 313 file, in 161,76 secondi. Nessun test applicativo escluso per ottenere il passaggio. |
| `.venv\Scripts\python.exe -m pytest -q` | 0 | 518 test superati e uno saltato; il caso symlink richiede i privilegi della piattaforma. |
| `npm run build` | 0 | TypeScript e bundle Renderer, Main e Preload compilati. |
| `npm run quality:static` | 0 | 98 registrazioni IPC validate, confini architetturali rispettati e 827 file controllati da Biome senza riscritture. |
| `pwsh -NoProfile -File scripts/lint_format.ps1 -Fast -SkipTests` | 0 | Formattazione, documentazione, JSON, typecheck, sintassi Python e smoke test Electron superati. Vitest è eseguito separatamente per evitare duplicazioni. |
| `npm run docs:check` | 0 | 56 file Markdown controllati, inclusa questa ricevuta. |
| `git diff --check` | 0 | Nessun errore di whitespace nei file già tracciati; verifica aggiuntiva su tutti i candidati del commit per file nuovi, UTF-8 senza BOM e LF. |

Il gate pre-commit locale è superato con la seconda esecuzione completa JavaScript, la suite Python, build e lint. Il primo fallimento resta documentato e il relativo approfondimento rimane aperto nel tracker: la riprova non ne dimostra la causa né lo considera risolto.

## Documentazione e diff

La [guida utente](./guida-utente.md) contiene 26 SVG statici con 192 nodi raggiungibili, al massimo 10 per figura, diramazioni etichettate e percorsi testuali equivalenti. Validazione XML, risorse esclusivamente locali e resa Chromium a 320, 768 e 1920 px superate; nessun testo fuori dai nodi né scorrimento orizzontale nell'anteprima. Gli script e le immagini di controllo restano esterni al repository.

Il diff completo è stato esaminato, incluse le aggiunte non ancora tracciate: nessun file temporaneo, log di debug, file ambiente o valore con forma di credenziale individuato nei candidati del commit. `.env.example` contiene esempi commentati e non è modificato. Le modifiche a DNS e redirect gestiscono rispettivamente risposte DNS vuote e chiusura/rimozione del file parziale prima del download successivo; i test aggiunti coprono ulteriori rifiuti e conservazione degli archivi.

Il primo fallimento Vite resta tracciato in `TEST-MANAGED-VITE-LOOPBACK-FLAKE-01` nel [tracker](../PROJECT_STATUS.json): il passaggio isolato non ne stabilisce la causa. L'assenza di Ruff nell'ambiente è stata rilevata con una sonda della versione; non sono state installate dipendenze. Il gate Python del repository usa la compilazione sintattica e pytest, entrambi eseguiti.

## Handoff e confini

Il prossimo P1 autonomo è `CODING-HISTORY-DUAL-FAILURE-EXPORT-01`: esportare la revisione rimasta in memoria quando falliscono sia lo storico canonico sia lo staging di recupero, con chiusura bloccata e readback indipendente in un profilo isolato. Il tracker conserva solo attività aperte, ordinate per priorità; la guida completata non viene aggiunta allo storico del tracker.

Nessuna nuova chiamata a modelli, migrazione personale, installazione o pubblicazione. Il Second Brain centrale resta in sola lettura: si propone di aggiungere al dossier OnlyRagV2 il riferimento alla guida offline e la regola di verificare i controlli effettivi oltre alle etichette i18n. Il push richiede una conferma esplicita successiva al riepilogo del commit.
