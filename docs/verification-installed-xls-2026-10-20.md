# XLS nel desktop installato — 20 ottobre 2026

`XLS-PARSER-MEMORY-ADMISSION-01` concluso e rimosso dal tracker: **14 casi nativi passati**, otto documenti confermati e 161 chunk riletti senza differenze. Restano **32 attività aperte**. [Ricevuta indipendente](./verification-installed-xls-2026-10-20.json).

Il candidato è `cpu-20261020-130728-0e85c502`, installato da NSIS nella directory isolata già usata per il ledger. Installer SHA-256 `7467194090ecd428351de480a35dba7e68cb3299f13c49a06978124d387e3706`; tutti i 3.589 file installati sono verificati contro il manifesto prima della prova. I 31 moduli Python congelati, incluso `main`, coincidono con i sorgenti dello ZIP esatto e del checkout: confrontati campi dei code object e costanti ricorsive, normalizzando soltanto il nome del file di build e l'ordine non significativo dei frozenset. La prova non ricostruisce le dipendenze native di terzi.

Il [runner desktop](../scripts/e2e/installedXls.mjs) avvia l'EXE installato con `--user-data-dir` in una radice nuova, senza modalità E2E. Main avvia automaticamente il proprio Sidecar; ingestione, rifiuti e riavvio attraversano Preload/IPC/Main/REST reali. Il [probe Win32](../scripts/e2e/installedXlsProbe.py) osserva soltanto figli con immagine e proprietario verificati. Per le interruzioni controllate verifica anche il timestamp di creazione del proprietario e mantiene gli handle; i thread sono verificati prima della sospensione. Non viene modificato alcun binario applicativo.

Ollama è volutamente irraggiungibile su loopback porta 9: si usa il fallback versionato dichiarato dall'applicazione. **Zero chiamate reali ai modelli** in questa matrice, nessuna estensione del budget ledger e nessuna qualifica di encoder o qualità semantica.

| Caso | Esito e picco di commit del processo worker |
| --- | --- |
| XLS piccolo | Ingestione riuscita; 70.098.944 byte. |
| Coordinata 65.536×256 sparsa | Cella finale e colonna 256 presenti nell'estratto; 81.924.096 byte. |
| Dodici fogli con stringhe lunghe | Selezionati i primi due, escluso Text2, nota di selezione/abbreviazione presente; 186.642.432 byte. |
| Denso senza opt-in completo | Rifiuto al gate 8 MiB; nessun parser creato. |
| Denso con opt-in | Rifiuto nativo al budget memoria; 519.864.320 byte. |
| Stringhe globali SST | Rifiuto nativo al budget memoria; 519.094.272 byte. |
| Ammissione Windows negata | Job esterno di prova limita il Sidecar a un processo e impedisce CreateProcess del parser: rifiuto di contenimento, nessun parser/handshake; limite di prova rimosso e ingestione successiva riuscita. |
| Timeout reale | Sospeso il worker posseduto: il controller applica il proprio limite di 60 secondi, termina il figlio e consente la successiva ingestione; 60.351 ms osservati. |
| Arresto del proprietario | Terminato il solo Sidecar identificato; worker terminato entro cinque secondi, richiesta fallita senza commit, riavvio IPC e nuova ingestione riusciti. |
| Output oltre 32 MiB | XLS valido di 10×150×128 celle da 256 caratteri, con dieci fogli selezionati: rifiuto del limite di output reale, 337.686.528 byte di commit; nuova ingestione riuscita. |

Le quattro ingestioni di recupero completano i 14 casi. Tutti i worker osservati terminano e restano sotto **536.870.912 byte (512 MiB)**. La metrica è `PROCESS_MEMORY_COUNTERS.PeakPagefileUsage`, non il picco contabile del Job. `IsProcessInJob` indica appartenenza a un Job, non ne identifica da solo la quota privata. La quota del controller, il rifiuto per memoria, il timeout e l'uscita del figlio dopo la morte del proprietario sono sostenuti anche dal codice congelato corrispondente e dagli esiti nativi.

Nei sette rifiuti/interruzioni, le intere tabelle logiche, inclusi vettori e metadati, sono identiche agli snapshot precedenti; tutti gli archivi già presenti conservano gli hash. Ogni tentativo fallito conserva esattamente il proprio `original.xls`, come da policy, senza inserirlo nell'indice. Tutti i file di input conservano SHA-256 iniziale. Dopo la riapertura installata, gli otto record completi, incluso Markdown e revisioni, coincidono con le risposte IPC già confermate; il marker deve appartenere al nuovo avvio.

L'ammissione negata installata esercita un limite reale a **CreateProcess**. L'iniezione puntuale di errore in `AssignProcessToJobObject` resta una regressione sorgente, applicata al medesimo controller verificato nel congelato; non viene presentata come un'iniezione binaria eseguita. Il precedente limite di output soltanto iniettato è invece raggiunto ora con input XLS reale. Queste prove qualificano il perimetro dichiarato, non ogni XLS possibile, alimentazione persa o prestazioni di grandi archivi.

Conservati anche i diagnostici: un log di startup leggeva il marker precedente prima della riscrittura, mentre l'osservatore dei casi usava già il nuovo proprietario verificato. Il runner ora attende un PID nuovo; un'ulteriore riapertura verifica marker fresco e otto record completi. Il primo helper di questo readback passava un docId scalare ed è stato correttamente rifiutato dallo schema IPC; input/helper/ricevuta conservati, poi `{docId}` passa senza cambiare il prodotto. Anche il primo confronto del bytecode, sensibile alla rappresentazione dei frozenset, è conservato; il confronto strutturale corretto passa per tutti i 31 moduli.

Evidenze: `%USERPROFILE%/OnlyRag-Live/installed-xls-20261020-v1`, 134 artefatti vincolati dalla ricevuta indipendente oltre al profilo preservato. Comandi: `node scripts/e2e/installedXls.mjs` con EXE/evidenze espliciti; helper di readback offline conservati nella radice di evidenze. Exit 0 per matrice, confronto congelato e readback finale. Passano inoltre 98 test TypeScript mirati, gate Python critico 15 casi, typecheck, statico e documentazione. Nessun sorgente applicativo modificato da questa qualifica, nessun commit/push o dato personale.

L'installazione temporanea e la registrazione sono state rimosse dal proprio uninstaller, senza flag di cancellazione dati. Profili, originali di prova e ricevute restano nelle radici di evidenza; i precedenti staging la cui pulizia era stata rifiutata dalla policy non sono stati ritentati.

La revisione automatica ha poi rifiutato, prima dell'esecuzione, anche la rimozione dei duplicati dei nuovi log TEMP: motivo `blocked by policy`, senza dettagli ulteriori. Tutti i 13 file rimangono presenti; sono copiati e verificati SHA-256 nella radice durevole. Nessuna cancellazione alternativa tentata. Residuo aggiunto a `RETAINED-RESIDUE-DISPOSAL-01`; il successo separato dell'uninstaller resta verificato.

Riferimenti: [Job Windows e processi figli](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects), [sospensione controllata dei thread](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-suspendthread), [significato del picco di commit](https://learn.microsoft.com/en-us/windows/win32/api/psapi/ns-psapi-process_memory_counters). Lettore PyInstaller effettivamente installato: 6.22.2; i confronti sono sui byte locali, non dedotti dalla documentazione corrente.
