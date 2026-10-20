# Passaggio di sessione: recupero agente e storico — 20 ottobre 2026

Richiesta esplicita: salvare il lavoro, fare commit sul branch principale e push, aggiornando il tracker per il cambio di sessione. Destinazione verificata: repository pubblico origin https://github.com/dennidalpos/OnlyRagV2, branch predefinito master; base 70341da05c56e8c152419ae83527d223d93b81f3, divergenza iniziale 0/0. Il commit che contiene questo documento identifica la consegna; la conferma del push e lo stato CI dell'esatto SHA vengono riletti dopo la pubblicazione e registrati nel dossier SecondBrain.

## Lavoro consegnato

- [Recupero dopo arresto forzato](./verification-agent-crash-recovery-2026-10-20.md): richieste accettate persistenti, ripresa esplicita scelta dal proprietario, ordine nella conversazione, identita terminali non ripetibili, trascrizione e checkpoint incrementali con primo baseline conservato. Un'azione interrotta senza esito confermato resta rifiutata e conservata.
- [Runner Electron](./verification-agent-harness-2026-10-20.md): otto scenari e nove guard qualificati con Main/Preload reali, servizi simulati isolati ed evidenze esterne al checkout.
- [Fixture CI Windows](./verification-ci-fixtures-2026-10-20.md): debounce con clock controllato e confronto delle directory reali per i percorsi TEMP 8.3/estesi. Il precedente run remoto di 70341da e fallito; le correzioni locali non certificano il futuro run remoto.
- [Provenienza dello storico](./verification-history-provenance-2026-10-20.md): spazio encoder completo, ruoli document/query, rifiuto delle incompatibilita e delle modifiche concorrenti, scoring L2 esplicito. I dati legacy sono preservati; ricerca e indicizzazione sulla tabella legacy restano rifiutate fino alla ricostruzione esplicita qualificata. Nessuna migrazione automatica.
- [Indagine loopback](./verification-loopback-probes-2026-10-20.md): 50.000 rifiuti corretti e ricevute native; causa del precedente falso positivo ancora non identificata, guardia invariata.

Conclusi e rimossi nei lotti precedenti soltanto AGENT-UNGRACEFUL-SHUTDOWN-RECOVERY-01, TEST-ELECTRON-AGENT-HARNESS-CONTRACT-01 e CI-WINDOWS-TEST-FIXTURES-01. Il difetto sorgente dello storico e corretto, ma il relativo task resta aperto per i criteri residui.

## Tracker e ripresa

[PROJECT_STATUS.json](../PROJECT_STATUS.json): **38 aperti, 20 autonomi e 18 con decisione del proprietario; 4 P1, 29 P2, 5 P3**. ID e priorita preservati. Solo il task CI cambia categoria dopo l'autorizzazione a commit/push; gli altri 37 record sono identici alla baseline di pubblicazione. Il tracker conserva soltanto lavoro aperto; note e ricevute datate mantengono le fasi precedenti.

1. Rileggere AGENTS.md, tracker, stato Git e dossier OnlyRagV2 in SecondBrain. Verificare l'esatto commit remoto e il suo run CI, senza attribuirgli il verde locale o quello di altre revisioni. Il task CI resta aperto finche i gate richiesti non risultano riusciti.
2. AGENT-INFLIGHT-EFFECT-RECONCILIATION-01: attendere la scelta gia richiesta su ispezione/abbandono oppure ulteriore tentativo con conferma del rischio di duplicazione. Domanda non risposta: nessuna politica scelta implicitamente e nessun replay.
3. HISTORY-EMBEDDING-CORRECTNESS-01: restano encoder/scoring reali e percorso di ricostruzione dello storico con backup/readback/rollback; il rebuild dei documenti non lo sostituisce. Nessuna nuova inferenza o migrazione personale autorizzata dalla pubblicazione.
4. DEVSERVER-LOOPBACK-PROBE-STABILITY-01: conservare la prossima riproduzione con endpoint/listener/processo; non indebolire i controlli.

Il runtime modificato richiede un futuro candidato corrispondente. Installer conservati, desktop installato, modelli reali, perdita di alimentazione, migrazioni personali, smaltimento delle evidenze e diritti/pubblicazione installer mantengono i rispettivi gate. Le richieste di autorizzazione precedenti non ricevono risposta implicita da questa pubblicazione dei sorgenti.

## Verifiche di pubblicazione

Gate completi ripetuti sulla consegna prima del commit:

| Controllo | Esito |
| --- | --- |
| npm run test -- --reporter=dot | 2940 passati / 322 file; durata nel log vitest-precommit.log |
| .venv/Scripts/python.exe -B -m pytest -q -rs --tb=short -p no:cacheprovider | 622 passati, 1 symlink di directory non disponibile saltato; 161.47 s; junction reali eseguite |

Typecheck, JSON, compilazione Python con cache esterna, 15 casi critici, 31 WhatIf e 17 cleanup reali, build e smoke Main Electron isolato sono eseguiti dal gate seriale pre-commit. Statico, documentazione, diff e indice vengono riesaminati prima di pubblicare; log nella cartella di recupero. Le due ricevute JSON dei lotti verificano per SHA-256 43 sorgenti runtime/test/probe identici a quelli gia qualificati, inclusi otto scenari/nove guard Electron e il precedente coverage completo. Nessuna modifica comportamentale aggiunta nel passaggio di pubblicazione.

## Recupero e conservazione

Backup iniziale con readback SHA-256 dei 59 file, patch binaria, bundle Git validato, snapshot finale, manifest e log in C:/Users/Utente/AppData/Local/Temp/onlyrag-publish-recovery-c461609878cd43c3a85ca82e25b065a3. Scansione limitata dei formati comuni di chiavi/token senza riscontri, senza certificazione generale di assenza di segreti.

La [ricevuta di pubblicazione](./verification-publish-recovery-2026-10-20.json) conserva sia gli hash dei 43 file qualificati sia quelli dei byte normalizzati LF da Git secondo .gitattributes. I vecchi hash descrivono i byte delle prove originali: non riscriverli per farli coincidere con una diversa convenzione di fine riga. Prima del commit viene verificata la corrispondenza degli hash LF con i blob effettivamente nell'indice.

Le fixture fallite e le cache esterne conservate nei lotti precedenti restano invariate; nessun nuovo tentativo di cancellare gli artefatti rifiutati dalla revisione automatica. Dati, configurazioni, dipendenze, build e candidati preesistenti preservati. Nessun nuovo scratch o worktree nel checkout. Dossier aggiornato in sessione Write e sincronizzato separatamente; nessun commit/push del repository SecondBrain.
