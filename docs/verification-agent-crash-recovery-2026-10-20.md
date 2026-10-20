# Recupero agente dopo arresto forzato — 20 ottobre 2026

`AGENT-UNGRACEFUL-SHUTDOWN-RECOVERY-01` è qualificato nel confine offline: Main/Preload della build di sviluppo, servizi di generazione deterministici su loopback e workspace/profilo temporanei. La scelta del proprietario è **conservare il lavoro e riprenderlo esplicitamente**. Installazione, modelli reali e perdita di alimentazione restano nei rispettivi task.

Il seguito completa anche il [runner Electron](./verification-agent-harness-2026-10-20.md) e le [due fixture CI Windows](./verification-ci-fixtures-2026-10-20.md). I tre task conclusi sono rimossi dalle liste aperte. Restano **38 ID: 19 autonomi e 19 con decisione utente**, compresi i nuovi residui su effetti interrotti, probe dev-server intermittente e qualifica CI remota. Dei 35 record precedenti ancora aperti, 33 sono identici; distribuzione e smaltimento ricevono solo precisazioni pertinenti, preservando criteri e priorità.

| Controllo finale | Esito e limite |
| --- | --- |
| `npm run test:coverage -- --coverage.reportsDirectory=<cartella esterna> --silent=true` | 2.940 passati / 322 file, 218,25 s; righe 73,89%, statement 72,25%, branch 63,27%, funzioni 66,17%. Gate passato. |
| Suite ordinaria TypeScript | 2.939 passati / 322 file, 186,85 s; la successiva coverage include anche la regressione sull'ordine di recupero. |
| `.venv\Scripts\python.exe -B -m pytest -q -rs --tb=short -p no:cacheprovider` | 598 passati / un symlink di directory non disponibile saltato, 187,99 s; junction reali eseguite. |
| Build e runner Electron completo | Passati; otto scenari di affidabilità e nove guard. Hash del bundle e del runner riletti nella ricevuta, fixture operative finali ripulite. |
| Gate seriale, statico e documentazione | Typecheck, JSON, compilazione Python con cache esterna, 15 casi critici e 31+17 cleanup; 858 file / 105 handler IPC; 82 pagine Markdown. |

Nessun commit, push, installazione o nuova chiamata a modelli reali. Il run CI precedente resta fallito; i risultati locali non sono una qualifica remota del nuovo codice.

## Comportamento verificato

- Main salva la richiesta completa prima di accettarla nella coda seriale. La ricevuta conserva identità, workspace, modello e permessi; nessun task riparte all'avvio. Un archivio illeggibile o pieno rifiuta nuove ammissioni conservando i byte precedenti.
- Nel Coding Agent della conversazione interessata il banner mostra il lavoro recuperabile e i permessi originali. Il pulsante **Riprendi task** riusa l'identità acquisita; non avvia gli altri task né svuota automaticamente la coda di prompt dopo il recupero. I normali nuovi avvii non possono riutilizzare identità già accettate.
- Nella stessa conversazione si recupera prima la richiesta accettata più vecchia; un nuovo avvio non può sovrascrivere lo stato di lavoro recuperabile. La regressione è stata osservata fallire prima del controllo e passare dopo la correzione, senza eseguire effetti reali.
- Prima di eseguire un tool si registra `apply_action`. Prima del risultato confermato al Renderer si persistono trascrizione, file modificati e checkpoint; il turno successivo non supera la persistenza. Dopo un'interruzione con esito dell'azione ignoto, la ripresa viene rifiutata e i dati restano conservati: non viene inventato un successo né ripetuto il comando.
- La ripresa conserva contatori, piano, trascrizione e mutazioni già effettuate, quindi la verifica finale considera anche i file modificati prima del crash. Le risposte Ask concluse hanno uno stato terminale persistente. Un checkpoint terminale impedisce il replay anche nella finestra precedente al ritiro della ricevuta della coda.
- I checkpoint dei file vengono salvati durante il lavoro senza svuotare il journal in memoria. Estensioni successive e riprese conservano la prima versione dei file e l'informazione che un file era stato creato; il manifesto viene sostituito dopo la scrittura dei nuovi blob. Identità della run e conversazione rimangono distinte.

## Prova nativa ripetibile

`npm run test:e2e:agent-crash` esegue build e lo scenario selezionato di `scripts/e2e/agentReliability.mjs --crash-only`. Lo scenario:

1. Approva un piano isolato, legge un file e crea un documento con contenuto sostanziale; il progetto include un test Node reale che controlla i byte creati.
2. Conserva trascrizione, stato e manifesto, accetta un secondo task in coda e termina forzatamente soltanto l'albero Electron avviato dalla prova.
3. Riavvia con lo stesso profilo, confronta lo snapshot esatto e il checkpoint e verifica che non siano partite richieste automatiche. Entrambe le richieste sono recuperabili.
4. Riprende esplicitamente la prima identità: la scrittura compare una sola volta nella trascrizione, il test del progetto passa e lo stato diventa terminale. Il secondo task resta in attesa fino alla propria richiesta di ripresa.
5. Riavvia ancora, rilegge il terminale e rifiuta i replay di entrambe le identità. Il ripristino esplicito del checkpoint elimina il solo file creato e conserva l'originale.

`ONLYRAG_RECOVERY_EVIDENCE` seleziona una cartella esterna in cui trattenere ricevuta, fallimenti e fixture delle prove fallite. I temporanei operativi sono rimossi verificandone la radice; le evidenze restano fuori dal checkout. Ricevuta sintetica e hash: [JSON](./verification-agent-crash-recovery-2026-10-20.json).

## Limiti e residui

La prova non dimostra esecuzione esattamente una volta per un effetto esterno interrotto prima della conferma persistente. Quella finestra viene rifiutata ed è tracciata separatamente per una procedura di riconciliazione. `AGENT-SESSION-LIVE-01` mantiene le prove con modelli reali; `STATE-WRITER-CRASH-DURABILITY-01` mantiene directory metadata e perdita di alimentazione. I candidati installer precedenti non contengono questo runtime.

La revisione automatica ha rifiutato la cancellazione di due fixture possedute con `blocked by policy`, senza una motivazione più specifica. Gli originali `node_modules/onlyrag-vite-preview-9AuK0z` e `%TEMP%/onlyrag-electron-e2e-Ttw2dr` sono conservati con copie e manifesti SHA-256 verificati fuori dal checkout; `RETAINED-RESIDUE-DISPOSAL-01` ne conserva il seguito. Non è stato tentato un percorso alternativo di cancellazione. Le due vecchie fixture Vite del 16 ottobre restano preesistenti e preservate.

La suite Electron completa preesistente si è fermata prima dello scenario di crash: la fixture di cancellazione sessioni ometteva il proprietario del workspace e attendeva ancora un booleano. Il successivo [riallineamento della suite](./verification-agent-harness-2026-10-20.md) corregge la fixture e qualifica tutti gli otto scenari e nove guard, conservando il fallimento iniziale. Una suite TypeScript iniziale ha inoltre osservato un rifiuto intermittente del probe dev-server su `127.0.0.2`; la ripetizione mirata dei nove casi e il giro completo successivo passano. Il comportamento intermittente viene tracciato senza attribuirgli una vulnerabilità o una causa non dimostrata.

Riferimenti primari: [Electron 43.7.4, ciclo di vita](https://github.com/electron/electron/blob/v43.7.4/docs/api/app.md), [Node 24.20.0, filesystem](https://github.com/nodejs/node/blob/v24.20.0/doc/api/fs.md), [Node 24.20.0, processi figli](https://github.com/nodejs/node/blob/v24.20.0/doc/api/child_process.md). Le API di flush e arresto sono esercitate dai runtime locali; flush di file e arresto di processo non certificano la perdita di alimentazione.
