# Correzione delle dipendenze — 16 ottobre 2026

Il push precedente mostrava un riepilogo GitHub di tre avvisi. Il successivo readback dell'API Dependabot sul ramo pubblico restituisce due avvisi aperti: `braces` (alto, GHSA-vfj7-8cjw-p6xm) e `sprintf-js` (moderato, GHSA-hp3w-g68c-fv3c). Il terzo, relativo alla cache HTTP, non è più aperto dopo l'aggiornamento già pubblicato. Questa sessione corregge i due residui nei sorgenti locali, senza chiudere o ignorare avvisi tramite API.

## Interventi

- `sprintf-js` è rimosso interamente dalla catena installata e dal lock. Gli override esatti di `argparse` 2.0.1 e `global-agent` 4.1.3 sostituiscono le vecchie dipendenze di js-yaml 3 e del downloader del builder; quest'ultimo non dipende più da roarr/sprintf-js. Non è stata applicata una patch a sprintf-js né un downgrade di depcheck, skott o electron-builder.
- `braces` non ha una release upstream corretta. Il fork privato in `vendor/braces-3.0.4/` conserva il nome dell'API e usa la versione locale **3.0.4+onlyrag.1**, esplicitamente distinta da una release pubblicata. La dipendenza root `file:` soddisfa l'intervallo già richiesto da micromatch e il lock deduplica tutte le copie. Non si usa un override relativo `file:`, che ha fallito la prova di installazione pulita con npm 11.19.0.
- La patch limita il parser prima dell'ingresso in nuovi frame e valida gli AST in modo iterativo prima di compile, expand e stringify. Rifiuta profondità superiori a 64 e più di 131072 nodi; non è possibile aumentare il limite tramite opzioni. Un rifiuto di profondità è un `SyntaxError` con codice `ERR_BRACES_DEPTH`, non un esaurimento incontrollato dello stack.
- `.npmrc` abilita solo `install-links=true`: il fork è installato con i suoi file e dipendenze come pacchetto ordinario, senza link verso la directory di sviluppo. L'eccezione Knip nominativa `braces` riguarda questo ancoraggio nella configurazione npm, la cui effettiva risoluzione attraverso depcheck/findup-sync/micromatch è verificata dai test.

Il fork conserva la licenza MIT. `UPSTREAM.json` registra tarball ufficiale, integrità SHA-512 e SHA-256 dei file originali. Una copia scaricata da npm è stata confrontata con tali digest; il compile originale riproduce `RangeError` su un AST di 10000 livelli. Le prove del fork rifiutano in modo controllato lo stesso tipo di AST, cicli, input sotto il limite di caratteri e frame incompleti, conservando alternative, range, escaping e deduplicazione ordinari.

Il lock è stato rigenerato da una copia della baseline e minimizzato: cambiano soltanto braces, global-agent e le sue dipendenze matcher/serialize-error/type-fest; spariscono le copie superflue di argparse 1 e sprintf-js/roarr. Nessun aggiornamento generale delle altre librerie è incluso.

## Prove e limiti

`scripts/dependencySecurityRemediation.test.mts` aggiunge 16 test. Il probe CI esistente `scripts/e2e/dependencySprintfExposure.mjs` verifica ora l'assenza effettiva di sprintf-js, parsing YAML/script con rilevazione degli import mancanti, conversioni della CLI YAML transitiva, versione della CLI YAML principale ed effettivo bootstrap di global-agent 4 attraverso il downloader del builder, con proxy HTTP reale su loopback e processo figlio isolato.

Il percorso applicativo usa js-yaml 3 come libreria, non la sua CLI interna. Il vecchio parametro deprecato `version` del costruttore argparse non conserva l'output di `--version` di quella CLI interna con argparse 2; help, conversioni e rifiuti funzionano e sono verificati. La CLI pubblicamente esposta dal progetto usa js-yaml 4 e conserva la propria versione. Non si dichiara compatibilità completa con tutte le API deprecate di argparse 1.

La prova nativa `dependencyScannerIsolation.mjs` è passata in Node e in Electron 43.7.4/ASAR: dichiarazioni/import mancanti, rifiuto di sorgenti e manifest invalidi, 200 file TypeScript/550 KiB, worker terminato e limiti mantenuti. Dopo npm ci sul lock definitivo, la misura Node ha rilevato 1606 ms e 56,3 MiB di heap terminale; la prova ASAR 58,7 MiB. Non sono misure del picco di memoria né prove su corpora arbitrari. `buildDownloadCachePolicy.mjs` mantiene rifiuto della cache corrotta, checksum e assenza di cookie/cache HTTP riutilizzati.

Una prima installazione isolata del layout definitivo è passata da zero con npm ci e audit senza avvisi. Anche `npm ci --ignore-scripts --no-fund` nella radice è passato sul lock finale minimizzato, seguito dal ripristino esplicito del runtime di sviluppo Electron con `node node_modules/electron/install.js`. La baseline originale, il tentativo di installazione fallito, le installazioni isolate e il backup del lock intermedio restano in directory `.system_generated/` ignorate da Git. Un comando combinato di installazione e pulizia è stato rifiutato dal controllo automatico; le verifiche sono proseguite senza cancellare quelle directory.

Controlli sul lock finale, tutti con exit code 0:

| Comando | Esito |
| --- | --- |
| `npm audit --json` | Nessun advisory npm segnalato, incluse le dipendenze di sviluppo. |
| `npm audit --omit=dev --json` | Nessun advisory npm segnalato per la produzione. |
| `npm run test -- --silent=true` | 2.797 test superati in 317 file, in 165,92 secondi; include i 16 nuovi casi. |
| `npm run build` | TypeScript, Renderer, Main, worker e Preload compilati. |
| `node scripts/e2e/dependencyScannerIsolation.mjs` | Worker reale e chiusura, errori e ASAR Electron superati. |
| `node scripts/e2e/dependencySprintfExposure.mjs` | Assenza del formatter, YAML, scansione e proxy reale su loopback superati. |
| `node scripts/e2e/buildDownloadCachePolicy.mjs` | Cache, integrità e gestione dei cookie superate. |
| `.venv/Scripts/python.exe -m pytest -q` | 518 superati, uno saltato, in 122,34 secondi. |
| `npm run quality:static` | 99 handler IPC, confini architetturali, lint e formato di 834 file. |
| `npm run audit:deadcode` | Entrambe le modalità Knip superate. |
| `npm run docs:check` | 58 documenti validati. |

Il tracker chiude il residuo sprintf-js e mantiene soltanto la futura sostituzione verificata del fork braces, insieme agli altri 46 task aperti. Il dossier SecondBrain è aggiornato con guard, backup e readback nella sessione Write registrata. Le modifiche preesistenti a `AGENTS.md` e `.continue/` sono escluse dalla consegna. Commit e push proseguono la richiesta esplicita dell'utente nella conversazione; nessuna API di dismiss o soppressione viene usata. Il confronto dell'HEAD e degli avvisi remoti è riportato dopo l'esecuzione nella risposta conclusiva.

Gli audit npm non analizzano semanticamente il fork locale: il loro zero non dimostra da solo la correzione. La copertura dell'advisory braces è sostenuta dalla patch e dalle regressioni; restano da mantenere provenienza, limite e confronto con future release upstream. La patch non promette di limitare ogni possibile espansione combinatoria. Nessuna modifica al runtime Sidecar, agli originali, a dati personali, installer conservati o modelli reali. Nessuna certificazione generale di assenza di vulnerabilità; il residuo Monaco incorporato resta distinto.

## Fonti primarie

- [Advisory braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), [segnalazione upstream](https://github.com/micromatch/braces/issues/70) e [sorgente 3.0.3](https://github.com/micromatch/braces/tree/3.0.3): nessuna versione corretta pubblicata al momento della verifica.
- [Advisory sprintf-js](https://github.com/advisories/GHSA-hp3w-g68c-fv3c): nessuna versione corretta pubblicata; la correzione qui è la rimozione dalle catene dipendenti.
- [Argparse 2.0.1, changelog e migrazione](https://github.com/nodeca/argparse/blob/2.0.1/CHANGELOG.md), [global-agent 4](https://github.com/gajus/global-agent/releases/tag/v4.0.0) e manifest delle versioni 2.0.1/4.1.3 interrogati nel registro npm.
- [npm 11, override](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#overrides) e [install-links](https://docs.npmjs.com/cli/v11/commands/npm-ci#install-links). Toolchain verificata: Node 24.20.0, npm 11.19.0, React 19.2.8, Electron 43.7.4.
