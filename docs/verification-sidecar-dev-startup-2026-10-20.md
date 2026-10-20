# Sidecar in sviluppo: stato iniziale — 20 ottobre 2026

Segnalazione: il widget «LanceDB Sidecar» mostra offline durante l'avvio. La diagnosi distingue preparazione dell'ambiente, disponibilità reale dell'API e stato visualizzato.

## Evidenza iniziale

Il log `%APPDATA%/onlyrag-v2/logs/app.log` registra il 20 ottobre, in ore **CEST**:

| Ora | Evento |
| --- | --- |
| 22:08:54 | Dipendenze assenti nel Python iniziale; preparazione automatica del virtualenv |
| 22:08:58 | Installazione dei requisiti runtime in `.venv` |
| 22:09:46 | Installazione completata e avvio Python |
| 22:09:50 | Health positivo e diagnosi online |
| 22:10:38 | Secondo avvio, dipendenze già disponibili |
| 22:10:41 | Secondo health positivo e diagnosi online |
| 22:11:00 | Chiusura app e arresto del Sidecar posseduto |

Alla diagnosi l'app risultava chiusa e la porta 8000 libera. Il nuovo `.venv` Python **3.13.15** supera gli import runtime richiesti e `pip check`. La ricreazione/installazione era stata eseguita automaticamente dall'app prima dell'intervento; questa verifica non reinstalla pacchetti.

Due regressioni renderer riproducono il difetto: assenza iniziale di diagnostica e stato `checking` erano entrambi resi come `Offline`. Inoltre i probe HTTP durante la preparazione sovrascrivevano `checking` con `offline`, anche con avvio ancora pendente.

## Correzione

Il gestore mantiene `checking` durante preparazione delle dipendenze, lancio e readiness. Chiamate concorrenti condividono la stessa operazione. Alla fine di un avvio senza readiness, lo stato torna `offline`; anche errori e guasti successivi restano visibili. Un avvio rifiutato libera l'operazione per la riprova esplicita.

Il widget usa la traduzione esistente `Verifica...`/`Checking...` e il colore di avanzamento durante `checking` o prima della prima diagnostica. Documenti online e offline effettivo mantengono i rispettivi stati. La fixture dei log Sidecar usa un profilo temporaneo posseduto prima degli import Electron, evitando scritture del logger nella root del checkout.

Per caricare il nuovo Main process in dev, chiudere e riavviare **`npm run dev`** dalla root. Il primo avvio con ambiente mancante può attendere l'installazione delle dipendenze. Quelle runtime installate automaticamente non certificano la disponibilità delle dipendenze di test di `requirements-dev.txt`.

## Verifiche

| Controllo | Esito e perimetro |
| --- | --- |
| Regressioni prima della correzione | Due fallimenti: stato iniziale e `checking` resi come `Offline`; undici casi esistenti passano |
| `npx vitest run` su manager, AppLayout/settings e polling diagnostico | **26 passati / 3 file**, inclusi preparazione, probe fallito, concorrenza, errore/retry, guasto dopo online e quattro stati del widget |
| `.venv/Scripts/python.exe -m pip check` e import runtime | Passati sull'ambiente corrente, senza reinstallazioni |
| Python/LanceDB reale, profilo isolato | `/health` online in **3,15 s**, documenti autenticati vuoti, accesso senza token **401**, processo posseduto arrestato |
| Gestore corrente dentro Electron **43.7.4**, profilo isolato | Avvio reale: soli stati **checking → online**, **6,30 s**, zero documenti, proprietà del processo e arresto posseduto |
| Corrispondenza della prova Electron | **93 file Sidecar** copiati e confrontati SHA-256 con i sorgenti versionati; gestore compilato dal sorgente corrente con Vite in directory esterna |
| `npm run typecheck`, `npm run quality:static` | Passati; statico 867 file/107 handler IPC |

La prova Electron carica il gestore di produzione dopo aver impostato i percorsi app isolati e avvia Python reale. Qualifica il modulo nativo, distinguendolo dalla finestra completa, dal Main bundle distribuito e da una nuova installazione. **Zero inferenze**, ingestioni o aggiornamenti dei dati personali. Suite complete e gate installati non sono dichiarati eseguiti.

Documentazione (105 pagine), JSON/formattazione e diff passano. Tutti i 66 file di `userdata_dev` e il log dell'app nel profilo di sviluppo reale conservano gli hash iniziali; la porta 8000 è libera dopo l'arresto delle prove.

Esito conservato qui senza creare un task aperto per il difetto corretto. I **34 task preesistenti** mantengono priorità, ordine e criteri; la qualifica di distribuzione richiede un artefatto corrispondente al runtime aggiornato.

Evidenze: `C:/Users/Utente/OnlyRag-Live/sidecar-dev-startup-20261020-c7e2c38d`: log antecedente, prove native, profili sintetici, sorgenti/hash e regressioni prima/dopo. Cache/output preesistenti con rifiuti di pulizia conservati; nessuna pulizia alternativa.

Fonti primarie: [Electron 43.7.4, percorsi app](https://github.com/electron/electron/blob/v43.7.4/shell/browser/api/electron_api_app.cc), [API app Electron](https://www.electronjs.org/docs/latest/api/app#appsetpathname-path), [mock dei moduli Vitest](https://vitest.dev/guide/mocking/modules.html). Versione e percorsi sono verificati anche nella prova nativa.
