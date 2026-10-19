# Qualifica delle verifiche native — 19 ottobre 2026

`PROJECT-VERIFICATION-NATIVE-QUALIFICATION-01` concluso sui progetti fixture Windows descritti qui. Il discovery riconosceva i manifest non Node, ma il resolver non offriva comandi nativi. Ora seleziona i comandi dalla configurazione osservata e richiede tutti gli stack presenti nella stessa directory, oltre ai progetti annidati.

| Manifest osservato | Comando | Evidenza dichiarata |
| --- | --- | --- |
| Configurazione pytest esplicita | `python -B -m pytest -q -p no:cacheprovider`, preferendo `.venv/Scripts/python.exe` se presente | Test |
| `go.mod` | `go test -mod=readonly -count=1 -timeout=30s ./...` | Test senza riutilizzo della cache dei risultati |
| `Cargo.toml` | `cargo test --offline`, aggiungendo `--locked` se esiste `Cargo.lock` | Test |
| `pom.xml` | `mvn --offline --batch-mode -DfailIfNoTests=true verify` | Strutturale; il lifecycle include i test del progetto |
| `build.gradle` / `build.gradle.kts` | `gradle --offline --no-daemon --console=plain check` | Strutturale; `check` dipende dal progetto |
| Script `test` terminante in `composer.json` | `composer --no-interaction --no-plugins run-script test` | Test dichiarato dal progetto |

La sola presenza di `requirements.txt` o di un generico `pyproject.toml` non inventa una suite pytest. Le letture della configurazione sono limitate a 256 KiB. File assenti, directory, errori e JSON Composer non valido non producono comandi. Non si usano wrapper di bootstrap che potrebbero scaricare strumenti.

Il runner mantiene il budget di 180 secondi per comando e l'annullamento della shell posseduta. Tool assente: `unverifiable` con `VERIFICATION_TOOL_UNAVAILABLE`, senza riutilizzare il precedente exit code. Errore reale: `failed`. Le impostazioni temporanee disabilitano provisioning dei package manager, Go proxy/checksum service e cambio toolchain, Cargo online, indice pip e rete Composer; vengono ripristinate dopo il comando. Sono controlli sui tool, **non una sandbox di rete per gli script del progetto**.

## Evidenze e ambiente

[`nativeProjectVerification.probe.ts`](../scripts/e2e/nativeProjectVerification.probe.ts) passa **10 casi** con PowerShell reale e fixture sotto TEMP con spazi nel percorso. Il dispatch iniettato usa la shell reale; discovery, resolver, guard, classificazione e timeout sono quelli di produzione. Per ciascuno dei sei ecosistemi passa il caso valido, poi fallisce un'asserzione intenzionalmente errata con diagnostica autentica. Maven usa JUnit 4.13.2. Gradle esegue un controllo Java `JavaExec` collegato a `check`, senza dipendenze di test esterne. Altri casi: tool assente con exit precedente zero, timeout a 1,5 secondi e nuova shell utilizzabile, ripristino ambiente, annullamento prima e durante l'esecuzione. Nessuno skip.

Ambiente effettivo: Windows, Node 24.20.0, npm 11.19.0, Python 3.13.15 / pytest 9.1.1, Go 1.27.0, Cargo 1.98.1, JDK 25.0.4.1, Maven 3.10.0, Gradle 9.8.2, Composer 2.10.3 e PHP 8.3.33. Node effettivo è distinto dalla versione dichiarata. Cargo era già installato fuori dal PATH della sessione. Su autorizzazione esplicita, Maven/Gradle/Composer sono installati portabili sotto `%LOCALAPPDATA%/OnlyRagDevTools`, dopo confronto con SHA-512/SHA-256 ufficiali. Composer usa un `php.ini` dedicato con OpenSSL locale; TLS resta attivo e il PHP globale non cambia.

Il primo passaggio ha rilevato configurazione errata della fixture Gradle e OpenSSL non abilitato nel PHP locale; corretti prima del passaggio finale. Corretto anche un errore di firma TypeScript nel dispatch di prova. Log iniziali/finali, checksum e backup: `%TEMP%/onlyrag-next-tasks-f68a963a1bb3421cb23a9340bc21cc6a`.

## Ripetizione e limiti

`npm run test:verification-native` richiede Windows e tutti i toolchain nel PATH, con JDK e dipendenze Maven presenti. [`test_native_verification.ps1`](../scripts/test_native_verification.ps1) accetta `-ToolPaths`, `-JavaHome` e `-PrepareDependencies`. Solo quest'ultima opzione consente un passaggio Maven con rete per preparare le dipendenze della fixture; la successiva verifica applicativa resta offline. Il wrapper ripristina l'ambiente. Le fixture sono rimosse dopo aver terminato le sole shell possedute. La qualifica ha una [configurazione separata](../vitest.native.config.mts), senza installazioni automatiche nella suite ordinaria.

La prova qualifica i manifest, toolchain e fixture dichiarati, non tutti i framework o versioni possibili, né il contenuto dei test di progetti arbitrari. Maven/Gradle restano evidenza strutturale. Nessuna prova di desktop installato, modello reale o migrazione personale.

## Fonti primarie

- [pytest: configurazione](https://docs.pytest.org/en/stable/reference/customize.html), [Go: test e flag](https://pkg.go.dev/cmd/go), [Cargo: test e offline](https://doc.rust-lang.org/cargo/commands/cargo-test.html).
- [Maven: download e checksum](https://maven.apache.org/download.cgi), [Gradle: CLI](https://docs.gradle.org/current/userguide/command_line_interface.html), [versione Gradle](https://services.gradle.org/versions/current).
- [Composer: script](https://getcomposer.org/doc/articles/scripts.md), [download Composer](https://getcomposer.org/download/).

## Integrazione finale del lotto

- Suite TypeScript completa sui sorgenti finali: **2.911 test passati in 320 file**, 182.51 s; 74 test mirati dei resolver/discovery/runner/reader passati.
- Qualifica nativa ripetuta tramite wrapper sui sorgenti finali: **10/10** con shell e toolchain reali, senza skip.
- Gate seriale con `-Fast -SkipTests -Format`: typecheck, 31 regressioni cleanup, 17 casi log e 15 casi Python critici passati. Build finale e controllo statico passati: 854 file e 103 handler IPC.
- Documentazione: 75 pagine validate; diff e confronto strutturale tracker verificati. Rimosse soltanto tre attività completate; restano 36 ID. Nessun commit/push o qualifica del desktop installato.

La prima suite estesa con tre regressioni aggiuntive ha rilevato il controllo mancante di presenza del file prima della lettura delle sezioni pytest. Corretto il resolver, passati i 74 mirati e ripetute le prove finali riportate sopra. I log precedenti restano conservati nel backup esterno. La suite Python completa non è stata ripetuta per questo intervento TypeScript/PowerShell/documentale; il gate critico Python è stato eseguito.
