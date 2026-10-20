# Correzione delle regressioni del verificatore — 20 ottobre 2026

Seguito autorizzato dall’utente con «tracciali e procedi», poi «continua», sui quattro rilievi dell’[audit del 19 ottobre](./repository-residue-audit-2026-10-19.md). La [ricevuta JSON](./verification-project-regressions-2026-10-20.json) lega risultati e log agli SHA-256 dei sorgenti/test. I rilievi erano già nel tracker: nessun ID duplicato. L’autorizzazione riguarda correzioni e verifiche offline; pubblicazione, installazioni, modelli e dati personali mantengono i confini precedenti.

## Risultati per attività

| Attività | Correzione e criterio verificato |
| --- | --- |
| `AGENT-VERIFICATION-CWD-BINDING-01` | Ogni verifica usa la root osservata con `Set-Location -LiteralPath` e ripristina la directory interattiva in `finally`. Una root Go fallita resta `failed` dopo `cd child`; dopo la correzione dell’asserzione entrambi i progetti vengono eseguiti. Coperti script che cambiano directory, root inesistente senza esecuzione del payload, spazi/apostrofi nel percorso, exit nonzero, annullamento e timeout. |
| `AGENT-PYTHON-PROJECT-DISCOVERY-01` | Discovery e resolver condividono il riconoscimento della configurazione pytest. Progetti configurati solo da `setup.cfg`/`tox.ini` entrano nel profilo e nei controlli richiesti; sezioni estranee non creano progetti Python. Fixture standalone fallita/passata e workspace misto con Python figlio fallito verificati con pytest reale. |
| `AGENT-VERIFICATION-EMPTY-TEST-EVIDENCE-01` | Il livello comportamentale richiede risultati riconoscibili con test passati, anziché il solo nome del comando. Go usa eventi JSON per singolo test; il successo del package non basta. Suite Go vuote/saltate e Rust vuote/ignorate restano strutturali; anche un `gradle check` senza sorgenti e uno script Composer opaco. Un requisito comportamentale esplicito senza test osservati resta `unverifiable`; una build primaria non sostituisce il test offerto e richiesto dal piano. |
| `DOCS-CURRENT-STATE-RECONCILIATION-01` | Riconciliati runtime/diagnostica Coding, guida Coding, ingestion, Main e comandi operativi. Le verifiche native e il ciclo degli archivi conclusi rimandano alle ricevute; staging completo e preparazioni incomplete sono descritti secondo il codice corrente. I riferimenti a ID chiusi nelle guide sono stati classificati come ricevute/decisioni datate, senza riscrivere archivi storici o riaprire attività concluse. |

Dopo i gate finali, il [tracker](../PROJECT_STATUS.json) rimuove soltanto queste quattro voci e torna a **36 attività aperte: 18 autonome / 18 con decisione utente, 4 P1 / 27 P2 / 5 P3**. Gli altri 36 record, priorità, liste e criteri sono identici alla baseline dell’audit; i criteri originali delle quattro chiusure sono conservati nella ricevuta JSON. Le qualifiche installate/live e il gap di provenienza dello storico non vengono chiusi da queste prove.

## Contratto dell’evidenza

[`withVerificationEnvironment`](../electron/core/infrastructure/process/powerShellCommand.ts) acquisisce la directory corrente, imposta la root letterale prima di controllare/eseguire il tool e ripristina directory e impostazioni ambientali. Un errore di ingresso/ripristino produce errore, senza promuovere un risultato. La shell interattiva mantiene il comportamento persistente previsto; non si introduce una seconda shell né si modifica il PATH globale. Timeout/Stop terminano soltanto la shell posseduta secondo il contratto esistente. Le opzioni offline dei tool **non costituiscono una sandbox di rete** per script arbitrari del progetto.

Il [parser dei risultati](../electron/core/domain/agent/testResultParser.ts) riconosce riepiloghi Vitest/Jest/pytest/Mocha, eventi Go, riepiloghi Rust e contatori Node TAP/spec, rimuovendo i codici ANSI. I test saltati/ignorati non diventano passaggi; per Go non sono contati eventi relativi al solo package. Il [runner](../electron/core/application/agentOrchestratorVerificationRunner.ts) verifica anche la corrispondenza del formato per i comandi nativi e lega le osservazioni al progetto/comando. Successo senza riepilogo interpretabile resta strutturale: non si inventano suite o un protocollo per script custom. Il requisito comportamentale esplicito aggiunge soltanto test già offerti dai manifest e non viene soddisfatto da output vuoto, saltato o sconosciuto.

Questa evidenza riguarda l’esecuzione dichiarata, non la qualità semantica dei test, la copertura universale o l’app installata. Quando si eseguono insieme build e test, il livello aggregato resta prudenzialmente strutturale; il requisito comportamentale del singolo comando viene comunque verificato.

Fonti primarie consultate: [Set-Location, PowerShell 5.1](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/set-location?view=powershell-5.1), [configurazione pytest](https://docs.pytest.org/en/stable/reference/customize.html), [eventi Go test2json](https://pkg.go.dev/cmd/test2json), [cargo test](https://doc.rust-lang.org/cargo/commands/cargo-test.html). Le prove reali usano le versioni installate riportate nella [qualifica nativa iniziale](./verification-native-projects-2026-10-19.md), senza scaricare toolchain o preparare dipendenze Maven in questa sessione.

## Verifiche

Prima delle correzioni, i nuovi controlli hanno prodotto **11 fallimenti di asserzione attesi** e 35 passaggi, senza errori di collection. Dopo le correzioni:

| Controllo | Esito |
| --- | --- |
| Cinque file mirati (discovery, parser, runner, resolver, shell reale) | 102 passati, 17,48 s. |
| `test_native_verification.ps1` con toolchain esistenti | 16 passati, nessuno skip, 70,99 s; sei ecosistemi e regressioni avversarie. |
| Suite TypeScript completa | 2.926 passati in 320 file, 212,18 s. |
| Suite Python completa | 598 passati e un symlink non disponibile saltato, 191,56 s; junction Windows reali eseguite. |
| `npm run build` | Exit 0: Renderer, Main, Preload e worker compilati. |
| `test_bundle_smoke.ps1 -Fast -SkipBuild` | Marker di inizializzazione del vero Main Electron confermato in un profilo temporaneo. |
| Gate seriale, statico, grafo e documentazione | Gate seriale passato: typecheck, sintassi Python, 15 casi critici, 31 WhatIf + 17 casi log; Knip doppio, cicli, statico (854 file/103 IPC), documentazione (78 pagine) e diff passati. |

I percorsi portabili Maven/Gradle/Composer e Cargo sono passati soltanto al wrapper, con JDK 25.0.4.1; il wrapper ripristina l’ambiente. Le fixture e le shell possedute sono ripulite. I test ordinari non installano toolchain e le prove native restano nella configurazione separata del progetto.

## Stato, recupero e limiti

Backup iniziale SHA-256 delle modifiche locali dell’audit e dei file coinvolti, log dei controlli e ricevute sono in `%TEMP%/onlyrag-verification-fix-9de78496ddcd46a9877030c9bce742b7`. Preservate le nuove direttive AGENTS.md ricevute durante il lavoro e gli artefatti dell’audit precedente. I controlli finali riesaminano diff e `git status --ignored`; dati, release, log e cache preesistenti non sono cancellati. La build aggiorna soltanto output generati già ignorati, senza costruire o riclassificare installer.

Contesto e memoria tecnica SecondBrain aggiornati in una sessione Write dopo il rilascio del writer altrui, con backup SHA-256 e rilettura verificati. Sincronizzazione riuscita: 23 repository, zero modifiche alle direttive e zero segnalazioni; sessione chiusa in `finally`. Nessun lock forzato o rimosso. La revisione automatica ha inoltre rifiutato l’eliminazione ricorsiva della cache Python temporanea con `blocked by policy`: `python-cache/` resta nella cartella di recupero fuori dal checkout. Backup, log ed evidenze sono conservati.

Nessun commit/push, distribuzione, installazione dell’app, nuova chiamata modello/encoder, migrazione personale o prova di perdita di alimentazione. Il runtime ora differisce ulteriormente dai candidati conservati: resta necessaria la qualifica del candidato corrente già tracciata, senza attribuire alle vecchie ricevute questi nuovi byte.
