# Pulizia esplicita dei log — 19 ottobre 2026

`CLEANUP-LOGS-POLICY-ALIGNMENT-01` concluso per la policy confermata dall'utente: nessuna scadenza automatica, app chiusa e selezione dei singoli file dopo revisione. Prima, `Logs` selezionava intere directory e il preflight rifiutava ogni `.log`: il comando poteva quindi cancellare cartelle prive di log, ma non i log applicativi.

Ora `clean_workspace.ps1 -Mode Logs` richiede `-DisposablePaths` con file assoluti e `-ApplicationClosed`. Quest'ultimo è un'attestazione dell'operatore, non un rilevatore di processi: nessun arresto automatico. Sono ammessi soltanto `app.log`, `app.1.log`, `app.2.log`, `coding_agent_audit.log` e le generazioni da `.1.log` a `.4.log`, direttamente nelle radici log già previste dal progetto. Il comando non sceglie automaticamente i file e non elimina directory. Nomi sconosciuti, log diagnostici/evidenze, JSONL, backup, dati, file tracciati e reparse point restano protetti. Le altre modalità conservano il rifiuto generale dei log.

La selezione completa supera il preflight prima di rimuovere qualsiasi file; `-WhatIf` valida senza cancellare. Ogni target viene rivalidato prima dell'operazione. File bloccati o mancanti producono errore. Non è una transazione atomica su più file e non elimina la finestra fra controllo e cancellazione: le race avversarie e lo smaltimento delle evidenze restano nel task esistente `RETAINED-RESIDUE-DISPOSAL-01`.

## Evidenze

- [`test_log_cleanup.ps1`](../scripts/test_log_cleanup.ps1): **17 casi** in repository Git e profili fittizi sotto TEMP. Cancellazione reale di tre generazioni esplicitamente selezionate; hash SHA-256 identici per tutti i file conservati, inclusi log attuale/audit, backup, diagnosi, JSONL, originali e impostazioni.
- Rifiuti: selezione assente, app non attestata chiusa, directory, nomi simili e parentesi letterali, file sconosciuti, root esterna, selezione mista valida/non valida prima di qualsiasi cancellazione, junction, file tracciato e file ormai assente. `WhatIf` conserva tutti gli hash.
- [`test_cleanup_policy.ps1`](../scripts/test_cleanup_policy.ps1): **31 casi WhatIf** di regressione, con junction native. Aggiornato il precedente caso che assumeva la selezione automatica della cartella Logs.
- Entrambe le suite sono collegate al [gate seriale](../scripts/lint_format.ps1), anche con `-SkipTests`. `npm run test:cleanup-logs` ripete la suite dedicata. Nessuna pulizia dei log reali dell'utente o delle evidenze preesistenti.

Fixture e junction create dalla prova sono rimosse nel `finally`, dopo verifica del percorso assoluto sotto TEMP. Log delle prove e backup: `%TEMP%/onlyrag-next-tasks-f68a963a1bb3421cb23a9340bc21cc6a`. La rotazione applicativa resta distinta dalla pulizia manuale: 2 MiB per il log generale con due generazioni, 10 MiB per l'audit con numero di file configurabile da uno a cinque.

Fonti primarie: [Windows PowerShell Remove-Item, LiteralPath e WhatIf](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/remove-item?view=powershell-5.1), [OWASP Logging Cheat Sheet: conservazione e protezione dei log](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html). I criteri di eleggibilità sono quelli approvati dall'utente, non una durata ricavata da queste fonti.

Integrazione del lotto: [suite completa, build e gate finali](./verification-native-projects-2026-10-19.md#integrazione-finale-del-lotto).
