# Gate Python dei percorsi critici — 19 ottobre 2026

## Risultato P03

`QUALITY-PYTHON-CRITICAL-PATHS-01` aggiunge un gate comportamentale offline ai controlli sintattici esistenti. Le voci precedenti del tracker conservano gate di installazione o modelli reali non autorizzati. Il lotto non cambia il codice applicativo Python o TypeScript e preserva le modifiche del precedente dettaglio del contesto chat.

`npm run quality:python` usa il Python della venv e [check_python_critical.py](../scripts/check_python_critical.py). La stessa verifica è obbligatoria in [lint_format.ps1](../scripts/lint_format.ps1), dopo `compileall` e prima di Vitest, anche con `-SkipTests`. La [CI Windows](https://github.com/dennidalpos/OnlyRagV2/blob/683fa1dae0a4f0b5f1856707fb29cea869395276/.github/workflows/ci.yml) invoca già quel gate seriale: il collegamento è nel codice locale; nessuna esecuzione remota di queste modifiche è attestata.

## Controlli selezionati

Il manifest dello script seleziona esplicitamente otto regressioni esistenti, espanse da pytest in **15 casi**, senza duplicarle o cambiare le aspettative:

| Percorso | Comportamento richiesto |
| --- | --- |
| Ingestione | Sei casi ASCII/astrali a ridosso della soglia UTF-16, inclusi heading; rifiuto prima di chunking/embedding e preservazione dei dati esistenti. |
| Archivio originale | Originale oltre soglia rifiutato prima del chunking anche se l'estrazione restituisce un testo breve; originale conservato. |
| CSV malformato | Tre forme malformate rifiutate senza indicizzazione parziale, con sorgente e conteggi invariati. |
| Ricerca | Fallback della query incompatibile con lo spazio memorizzato rifiutato; un errore FTS non diventa un risultato denso apparentemente valido. |
| Revisione | Una revisione client superata viene rifiutata prima della codifica; documento/chunk vincenti restano identici. |
| Persistenza | Errore della seconda scrittura ripristina entrambe le tabelle; recupero fallito conserva il journal e blocca accesso/health. |

Il processo figlio usa percorsi test assoluti e la configurazione del repository, con directory di lavoro/report temporanei fuori dal checkout. Riutilizza gli store isolati e gli encoder sintetici dichiarati da `conftest.py`; esclude URL/token del server frozen, opzioni/plugin pytest ereditati e diagnostiche verso Ollama reale. Non scrive bytecode o cache pytest nel checkout. Il subprocess ha un limite di 180 secondi e propaga gli exit code non zero.

Oltre all'esito pytest, il report JUnit deve contenere tutte e sole le funzioni richieste, senza failure, errori o skip. Un'esecuzione filtrata o interamente saltata non viene accettata come successo. `--runxfail` esegue normalmente anche eventuali test marcati xfail. Sei regressioni del validatore coprono report valido, vuoto, incompleto, saltato, fallito o con errore. Le opzioni usate sono provate con **pytest 9.1.1** della venv; riferimenti ufficiali: [invocazione e selezione](https://docs.pytest.org/en/stable/how-to/usage.html), [JUnit e opzioni](https://docs.pytest.org/en/stable/reference/reference.html), [exit code](https://docs.pytest.org/en/stable/reference/exit-codes.html).

## Prova dei segnali di fallimento

Il qualificatore conservato in `%TEMP%/onlyrag-p03-python-quality-9af85aed895d46248670242db5001723/qualify_mutations.py` copia soltanto sorgenti/test Sidecar, configurazione pytest e gate in nuove radici temporanee. Applica mutazioni sintatticamente valide, esegue lo stesso gate e richiede exit 1 con il nome del controllo atteso tra i test falliti: un errore di raccolta non conta come rilevazione. Il baseline identico deve passare. Gli hash dei tre moduli applicativi prima/dopo devono coincidere e le copie temporanee devono risultare rimosse.

Le mutazioni riguardano il rifiuto del testo oltre soglia, i due controlli di compatibilità degli spazi della query e il ripristino delle tabelle nel ramo di rollback. Log e ricevuta JSON conservano gli esiti puntuali; nessuna mutazione viene applicata ai sorgenti nel checkout o a dati personali. Il primo tentativo diagnostico si è fermato prima della mutazione di persistenza perché l'ancoraggio era ambiguo tra recovery e rollback; conservato in `attempt-1`, corretto soltanto il qualificatore esterno usando il contesto del ramo `except`.

| Variante | Esito dello stesso gate |
| --- | --- |
| Baseline senza mutazioni | Exit 0, 15 passati. |
| Ammissione oltre soglia disattivata | Exit 1, 3 falliti/12 passati; rilevati i due confini oltre soglia e il rifiuto dell'archivio originale. |
| Controlli degli spazi query disattivati | Exit 1, 1 fallito/14 passati; la ricerca incompatibile arriva a HTTP 200 e il controllo richiede invece il rifiuto. |
| Ripristino nel rollback omesso | Exit 1, 1 fallito/14 passati; il confronto delle due tabelle rileva i chunk non ripristinati. |

## Comandi eseguiti

- `npm run quality:python`: **15 passati**, 3,55 s, exit 0.
- `.venv\Scripts\python.exe -m pytest -q sidecar/tests/test_python_critical_gate.py`: **6 passati**, 2,20 s.
- `.venv\Scripts\python.exe -m pytest`: **589 passati, 1 saltato**, 167,55 s. Il symlink resta saltato; la junction Windows reale è eseguita.
- `pwsh -NoProfile -File scripts/lint_format.ps1 -Fast -SkipTests -Format`: **exit 0**; docs su 70 pagine, JSON, typecheck, sintassi Python e nuovo gate (15 passati in 3,58 s). Questa combinazione esclude Vitest e lo smoke Electron secondo il contratto dello script.
- `npm run quality:static`: **exit 0**, 853 file e 103 handler IPC. Sintassi dei due nuovi file Python e `git diff --check` passati.

Suite TypeScript, build e prova Electron non ripetute: il lotto modifica soltanto il gate Python, sei test del suo report e la documentazione. Le ricevute precedenti restano separate. Tracker: rimossa soltanto `QUALITY-PYTHON-CRITICAL-PATHS-01`, altre 40 voci, note e priorità invariate; 22 autonome e 18 con decisione utente.

## Limiti

Il gate verifica i comportamenti dichiarati su fixture e LanceDB reali isolati. Non è un linter Python generale, una verifica dei tipi, una soglia di copertura o una qualifica di encoder/modelli, app installata o perdita di alimentazione. Le tre mutazioni dimostrano sensibilità a quei difetti rappresentativi, senza misurare un mutation score generale. La suite completa rimane necessaria nei gate che già la richiedono; questo sottoinsieme serve a fallire prima sui percorsi critici.

Non sono autorizzati da questo lotto installazioni, chiamate modello reali, migrazioni personali, commit, push o pubblicazioni. I log ignorati preesistenti del lotto precedente sono conservati.

Backup e ricevute sono nella radice TEMP indicata sopra. Confronto SHA-256 conferma invariati i file preesistenti non coinvolti e i due log applicativi del lotto precedente. Le quattro copie del qualificatore concluso sono rimosse; i tre bytecode creati per i nuovi script/test sono trasferiti fuori dal checkout con readback SHA-256. Cache, dati e build già presenti sono conservati. Diff e `git status --ignored` riesaminati; nessun nuovo scratch, profilo o worktree nel checkout.

Dossier aggiornato con backup verificato e sessione cooperativa chiusa in `finally`; Sync concluso su 23 repository con zero segnalazioni.
