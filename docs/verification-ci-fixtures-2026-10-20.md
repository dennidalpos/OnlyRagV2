# Fixture Windows e stato CI — 20 ottobre 2026

Il [run 39380408183](https://github.com/dennidalpos/OnlyRagV2/actions/runs/39380408183), relativo all'esatto commit `70341da05c56e8c152419ae83527d223d93b81f3`, è **completed/failure**. Il dossier precedente lo registrava ancora in corso. Il job `verify` ha fallito il comando coverage per due asserzioni dei test: 2.924 test passati e due falliti. Questo esito non prova un superamento delle soglie percentuali di coverage.

`CI-WINDOWS-TEST-FIXTURES-01` riguarda le correzioni locali dei due casi:

- Il test del debounce attendeva un solo riavvio dopo tre salvataggi su disco con un intervallo artificiale di 20 ms. Sul runner i salvataggi hanno superato quell'intervallo, producendo tre chiamate coerenti con la temporizzazione impostata. La prova ora usa il clock controllato di Vitest e il confine di salvataggio confermato: verifica la normalizzazione dell'host, nessun riavvio prima dei 1.500 ms di inattività e un solo riavvio alla scadenza. La persistenza reale resta coperta dagli altri casi del repository/service; il runtime non cambia.
- Il test della root PowerShell confrontava i caratteri del percorso: `C:\Users\RUNNER~1\...` contro `C:\Users\runneradmin\...`. La directory esistente viene ora confrontata tramite `fs.realpathSync.native`, mantenendo exit code, ripristino della directory interattiva e rifiuto della root assente. Un'altra root reale continua a far fallire l'asserzione. Non viene attribuita a questa postazione una nuova esecuzione con l'alias 8.3 del runner.

I 19 casi mirati dei due file e il gate coverage completo passano: **2.940 test / 322 file**, 218,25 s; righe 73,89%, statement 72,25%, branch 63,27%, funzioni 66,17%. `CI-WINDOWS-TEST-FIXTURES-01` è quindi concluso e rimosso dalla lista aperta. La qualifica locale completa e gli hash sono nella [ricevuta](./verification-agent-crash-recovery-2026-10-20.json). Le prove usano Vitest 4.1.11 e la shell Windows reale dove previsto. Fonti: [timer di Vitest](https://vitest.dev/api/vi.html#vi-usefaketimers), [Node 24.20.0, filesystem](https://github.com/nodejs/node/blob/v24.20.0/doc/api/fs.md).

La qualifica remota resta distinta in `CI-CURRENT-REVISION-REMOTE-QUALIFICATION-01`: serve il successo dei gate sull'esatto futuro commit autorizzato. Il run fallito rimane conservato; nessun rerun, commit o push è stato effettuato in questo lavoro offline.
