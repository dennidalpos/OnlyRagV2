# Passaggio di sessione: audit e correzioni del verificatore — 20 ottobre 2026

Il proprietario ha richiesto salvataggio, commit sul principale, push e aggiornamento del tracker per cambiare sessione. Destinazione verificata: repository pubblico `dennidalpos/OnlyRagV2`, `origin`, branch predefinito `master`. Base prima della pubblicazione: `ceef495a5efc52bfb100fd6600a542a3a789f060`, allineata a `origin/master` dopo fetch; un branch locale e un worktree. Il dossier SecondBrain riporta SHA risultante, readback del push e stato della nuova CI.

## Risultato e stato aperto

L’[audit trasversale](./repository-residue-audit-2026-10-19.md) conserva evidenze, aree esaminate e limiti dell’analisi offline. Il seguito autorizzato ha [corretto e qualificato quattro rilievi](./verification-project-regressions-2026-10-20.md), conservandone i criteri originali e gli hash dei sorgenti nella [ricevuta](./verification-project-regressions-2026-10-20.json).

| Attività conclusa | Risultato |
| --- | --- |
| `AGENT-VERIFICATION-CWD-BINDING-01` | Ogni verifica entra nella root letterale osservata e ripristina directory e ambiente della shell; un precedente `cd` non può far verificare un altro progetto. |
| `AGENT-PYTHON-PROJECT-DISCOVERY-01` | Discovery e resolver condividono le configurazioni pytest valide, incluse `setup.cfg` e `tox.ini`, anche nei workspace misti. |
| `AGENT-VERIFICATION-EMPTY-TEST-EVIDENCE-01` | Suite vuote, saltate o opache restano strutturali; una prova comportamentale esplicita richiede test eseguiti con risultati interpretabili. |
| `DOCS-CURRENT-STATE-RECONCILIATION-01` | Guide correnti riconciliate con verifiche native, archivi e promozione degli staging completi; ricevute storiche preservate. |

Il [tracker](../PROJECT_STATUS.json) contiene **36 attività aperte: 18 autonome, 18 con decisione utente; 4 P1, 27 P2, 5 P3**. Solo i quattro rilievi conclusi sono stati rimossi dal tracker aperto. Tutti gli altri record, priorità, dipendenze e criteri sono identici alla baseline dell’audit; questa pubblicazione aggiunge soltanto una nota di consegna. `AGENTS.md` include il riallineamento SecondBrain preesistente, preservato senza modificare manualmente i blocchi gestiti.

## Ripresa

Leggere direttive, `PROJECT_STATUS.json`, stato Git e dossier `02-areas/products/OnlyRagV2/context.md` e `memory.md` sotto SecondBrain. Verificare il run CI dell’esatto commit pubblicato: la [CI riuscita di `ceef495`](https://github.com/dennidalpos/OnlyRagV2/actions/runs/39328778562) riguarda la base e non il nuovo commit. Le dichiarazioni di assenza di commit/push nei resoconti precedenti descrivono le fasi anteriori alla richiesta di pubblicazione.

Il candidato offline già tracciato è `AGENT-UNGRACEFUL-SHUTDOWN-RECOVERY-01`: confrontare prima implementazione e fixture, poi qualificare arresto del solo processo posseduto, checkpoint, coda e ripresa senza duplicare esecuzioni. Non è stato avviato in questa consegna; priorità e criterio del tracker restano invariati.

Il runtime corretto richiede un futuro candidato corrispondente. I vecchi installer conservano valore storico; installazione, nuove chiamate ai modelli, migrazioni personali, smaltimento delle evidenze e pubblicazione installer mantengono i rispettivi gate. Le toolchain native esistenti e il wrapper con percorsi temporanei restano documentati in [operations](./operations.md).

## Verifiche

Gate completi ripetuti prima del commit:

| Controllo | Esito |
| --- | --- |
| `npm run test -- --reporter=dot --silent=true` | 2.926 passati / 320 file, 193,19 s. |
| `.venv\Scripts\python.exe -B -m pytest -q -rs --tb=short -p no:cacheprovider` | 598 passati / 1 saltato, 163,71 s; symlink di directory non disponibile, casi junction reali eseguiti. |
| `npm run quality:static` | 854 file e 103 handler IPC, nessuna correzione automatica. |
| `npm run docs:check` | 79 pagine Markdown, link e comandi validi. |

`pwsh -NoProfile -File scripts/lint_format.ps1 -Fast -SkipTests -Format` passato: typecheck, JSON, compilazione Python con cache esterna, 15 casi Python critici (6,95 s) e 31+17 casi cleanup. Controllati anche diff, indice e schema del tracker; i 36 record e le note storiche sono preservati. La scansione limitata di formati comuni di chiavi/token non ha riscontri nei file selezionati, senza costituire una certificazione generale.

Gli **11 file runtime/test/probe** coincidono per SHA-256 con lo snapshot qualificato: **102 test mirati**, **16 prove native reali senza skip**, build, smoke Electron isolato, Knip e cicli già passati su quei byte. Questa consegna non modifica ulteriormente il comportamento applicativo e non attribuisce a quelle prove qualifica installata, semantica o di perdita di alimentazione.

## Recupero

Backup con readback SHA-256 di tutti i file modificati/non tracciati, patch binaria, bundle Git validato e log pre-commit in `%TEMP%/onlyrag-publish-verifier-64b255e90cb74ac9916d3ebf1c0e0335`. Copie verificate dei due log applicativi sono fuori dal checkout; originali e dati ignorati preesistenti, dipendenze, cache, build e candidati sono conservati. Nessun nuovo scratch o worktree nel checkout.

La cache Python esterna del lotto precedente rimane conservata: la revisione automatica ne aveva rifiutato la cancellazione con `blocked by policy`, come registrato nella ricevuta delle correzioni. Nessun nuovo tentativo di cancellazione in questa consegna. Dossier aggiornato e sincronizzato separatamente; nessun commit o push di SecondBrain.
