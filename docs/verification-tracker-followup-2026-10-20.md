# Seguito del tracker — 20 ottobre 2026

Cinque attività concluse e rimosse dal tracker, ora **32 ID aperti** (14 autonomi e 18 owner-required). Schema, priorità e liste degli altri record preservati; residui precisati con evidenze nuove. Nessun commit o push.

| Task concluso | Risultato |
| --- | --- |
| `AGENT-INFLIGHT-EFFECT-RECONCILIATION-01` | [Ispezione e abbandono](./verification-inflight-reconciliation-2026-10-20.md), senza replay/rollback; richiesta e prove archiviate con readback. Tre tagli del processo con comandi figli reali ripetuti anche nell'EXE installato. Regressione della race fra archiviazione e nuova ammissione. |
| `SETTINGS-CLOSE-DURABILITY-01` | [Impostazioni installate](./verification-installed-settings-2026-10-20.md): pending close, scrittura fallita/rifiuto chiusura, retry, riavvio, kill posseduto e readback dell'intero oggetto confermato. |
| `DISTRIBUTION-PACKAGE-SIZE-01` | [Misura del candidato](./verification-candidate-footprint-2026-10-20.md): CPU/OCR, conteggi, nessuna accelerazione inclusa, avvio automatico installato e corrispondenza indipendente di installer/payload. |
| `RAG-STRUCTURE-AWARE-CHUNKING-01` | [Valutazione conclusa](./verification-structure-chunking-2026-10-20.md), candidato rifiutato: stessi 9/11 passaggi globali e stessi rank; nessuna integrazione o migrazione. |
| `XLS-PARSER-MEMORY-ADMISSION-01` | [Qualifica installata](./verification-installed-xls-2026-10-20.md): 14 casi nativi, ammissione/memoria/timeout/owner-crash/output e recupero, otto record completi dopo riavvio. Zero nuove chiamate ai modelli. |

La [campagna ledger aggiuntiva](./verification-ledger-bounded-2026-10-20.md) esegue le otto chiamate autorizzate e passa otto riletture audit complete dopo riavvio installato. Estrazione 1/4 accettata, piani non qualificati nel budget; sette richieste aggiuntive bloccate prima del modello. Il task P1 e i suoi criteri restano aperti. Il budget non è più pendente: è ricevuto ed esaurito. Profili e prove conservati; la nuova installazione temporanea e la sua registrazione sono rimosse dall'uninstaller senza cancellare app data. Le note precedenti mantengono il proprio stato storico.

## Candidato e controlli

Finale: `cpu-20261020-130728-0e85c502`, installer 416.384.924 byte, SHA-256 `7467194090ecd428351de480a35dba7e68cb3299f13c49a06978124d387e3706`. Il primo `cpu-20261020-114718-c7ebd99c` rimane intermedio, precedente al fix di concorrenza. Nessun candidato è pubblicato.

Estratti indipendentemente NSIS e `app-64.7z`: 3.589 file corrispondenti al manifesto e ai byte installati, 1.240.921.256 byte; 54 file generati ASAR identici al build locale. Verificati i 1.162 file dell'archivio sorgente. L'unica differenza runtime successiva è la formattazione Biome di `taskQueueAppService.ts`: albero sintattico TypeScript identico, senza riscrivere lo snapshot archiviato.

Passano **2.948 test TypeScript/322 file** (201,21 s), **622 Python** (200,69 s; un symlink di directory non disponibile saltato, junction reali eseguite), **64 mirati/5 file**, typecheck, gate Python critico 15 casi, 31+17 cleanup, statico 859 file/107 IPC, Knip doppio, cicli, documentazione, build e smoke. Il confronto delle evidenze native conferma lo stesso hash Main nell'ASAR.

Sul candidato finale passano OCR CPU, autenticazione, PDF Unicode e fallback con Ollama indisponibile; nell'EXE installato senza E2E passano avvio Sidecar automatico, otto ingestioni con Nomic reale senza fallback, originali invariati e readback dopo riavvio. Impostazioni, tre interruzioni agente e chat/bozze a 1024×720 e 1920×1080 sono provati nell'EXE installato; generazione e servizi documento delle prove di recupero restano simulati. L'installazione temporanea e la sua registrazione sono rimosse tramite l'uninstaller, senza flag di eliminazione dei dati; profili, ricevute e installer restano conservati.

## Residui conservati

La [campagna live corrente](./verification-live-content-2026-10-20.md) completa la raccolta ma fallisce correttamente l'accettazione: 5/12 risposte congiuntamente accettate, 10/12 contenuto, 5/12 lingua, 10/12 citazioni, 9/11 passaggi globali. Il task P1 resta aperto con tutti i criteri originali. Corretto il runner della persistenza chat e il tipo IPC `taskId`, ora obbligatorio come lo schema runtime.

XLS installato è ora concluso nel perimetro dichiarato dalla nuova ricevuta. Distribuzione completa, traduzione/cancellazione reali, ricostruzione dello storico, hardware/perdita di alimentazione e altre qualifiche rimangono nei task esistenti: i successi meccanici circoscritti non li chiudono. Il precedente controllo del registro npm riportava `braces` 3.0.3; questa campagna non ripete tale controllo e il fork resta nel perimetro di manutenzione esistente. Nessuna mitigazione Monaco nuova è dichiarata.

Il percorso diagnostico storico `%TEMP%/onlyrag-p03-source-519e4b2946c648bfb6bca92e06452ec6` non risulta disponibile al readback, inclusi i due helper citati. La causa non è verificata e non è attribuita a questo task. Le ricevute versionate restano datate; il problema è aggiunto al task di conservazione già esistente, senza autorizzare cancellazioni.

Le nuove evidenze complete, tentativi falliti inclusi, hanno copia SHA-256 in `C:/Users/Utente/OnlyRag-Live/tracker-followup-20261020-c9663097`; il manifesto mappa il precedente root temporaneo. Le copie ricostruibili del payload estratto e dell'installazione sono rappresentate dagli installer conservati e dai manifest verificati; i profili e gli store di prova sono copiati integralmente.

Le campagne ledger precedenti conservano i propri marker spesi. La risposta alla nuova campagna distinta è arrivata: quattro estrazioni e quattro candidati reali eseguiti, otto chiamate esaurite, qualifica ancora aperta e audit installato riletto. Nessun marker è azzerato, riutilizzato o aggirato spostando il root. Autorizzazioni a candidato/installazione isolata e modelli locali su dati di prova restano registrate; il nuovo limite esplicito non permette altre inferenze ledger. Per la successiva qualifica RAG è richiesta la scelta del carico e dell'obiettivo di latenza; nessun carico non concordato è dichiarato rappresentativo.

## Pulizia: rifiuto della revisione automatica

La revisione automatica ha rifiutato prima dell’esecuzione la rimozione dei quattro staging `installer-extraction`, `installer-extraction-final`, `payload-extraction`, `payload-extraction-final` nel root temporaneo di questo task. Motivo restituito: **blocked by policy**, senza ulteriori dettagli. Sono tutti ancora presenti, con installer/manifest/evidenze verificati nella copia durevole; nessun metodo alternativo di cancellazione è stato tentato. Il residuo è aggiunto al task di conservazione esistente. L’uninstaller dell’installazione di prova, eseguito prima di questo rifiuto e verificato separatamente, è invece riuscito.

## Consegna sorgenti per cambio sessione

La successiva [consegna su master](./session-handoff-tracker-2026-10-20.md) è esplicitamente autorizzata per commit e push. Nel controllo remoto emerge il timeout CI audit del commit base `f1dd1b7`, aggiunto come residuo P2 senza modificare i 32 record aperti dopo XLS: tracker aggiornato a **33 attività**. I conteggi e i controlli sopra descrivono il lotto precedente alla pubblicazione. I nuovi gate completi sono riportati nella consegna.
