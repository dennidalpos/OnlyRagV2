# Audit critico applicativo — 21 ottobre 2026

Audit locale autorizzato con correzioni, senza commit, push o pubblicazione. Base `c0e9e58d1c27a0b9298e5aa90d7362bc0ea46219`, branch `master`, checkout iniziale pulito salvo directory ignorate. Dossier, ricevute storiche e tracker sono stati confrontati con i sorgenti; i loro esiti precedenti non sono stati usati come prova del comportamento nuovo.

## Problemi corretti

| Priorità | Riscontro riprodotto | Correzione e prova |
| --- | --- | --- |
| P1 | `fetchWebContent`: redirect con URL malformato causa un'eccezione fuori dal percorso di errore; risposta interrotta non termina la promessa. Il Main tratta eccezioni non gestite come fatali. | Gestione esplicita di errori/aborted/close, redirect validato, singolo terminale, distruzione delle risposte rifiutate. Regressioni HTTP native falliscono sulla base e passano sul fix; non è stato provocato il crash di un'app personale. |
| P1 | Pillow 12.3.0 installata: 8 advisory PyPI, 9 OSV; i decoder di immagini non fidate appartengono ai percorsi OCR. | Floor `pillow>=13.0.0`, vincolo esatto 13.0.0 e wheel Windows CPython 3.13. Test di sei codec nativi, resize, orientamento EXIF e OCR; audit noti ripetuti. Nessuna prova di sfruttamento o attribuzione di tutti gli advisory a un percorso raggiungibile. |
| P2 | Il limite fetch era espresso in caratteri: una risposta da 6 MiB UTF-8 veniva accettata. I listener abort restavano dopo completamento/redirect; il fallback senza risultati perdeva il segnale. | Limite 5 MiB sui byte prima dell'accumulo, deadline totale di risposta 15 s per hop oltre al timeout socket, rilascio dei listener e propagazione del segnale. Otto nuove regressioni iniziali falliscono sulla base. Il massimo resta sei hop: la deadline non è un limite di 15 s dell'intera catena né della conversione HTML sincrona. |
| P2 | Il controllo MIME del download vedeva soltanto il primo chunk: `%` seguito da `PDF-1.7` veniva pubblicato come `image/png`. | Prefisso di otto byte accumulato fra chunk, controllo anche al termine dei corpi corti e prima della pubblicazione. Prova negativa con staging realmente scritto; sul fix la destinazione precedente rimane esatta. Il controllo riconosce un insieme limitato di firme, non certifica tipo o sicurezza arbitrari. |
| P2 | La conversione indipendente di ogni Buffer NDJSON corrompe un carattere multibyte diviso tra chunk. | Decoder UTF-8 sullo stream di risposta comune Ollama, prima dei consumatori JSON/NDJSON. Un server controllato invia il resto soltanto dopo il consumo del primo record: fallisce prima, conserva testo/pensiero multilingue dopo. Nessun modello reale. |
| P2 | Electron 43.7.4 precede i backport correnti della linea 43. | Aggiornamento esatto a 43.8.3, incluse autorizzazioni degli script npm e lock. Resto dell'albero bloccato invariato. Lettura del processo nativo: Electron 43.8.3, Chromium 150.0.7871.250, Node incorporato 24.22.0. Non è una dichiarazione di specifiche CVE applicative risolte. |
| P3 | Informazioni riportava Vite 8.2.1, React 19.0.0, Monaco 4.7.0 e TypeScript Compiler API 5.x; citava Fast-Levenshtein assente e Ignore come motore applicativo senza chiamanti. | Versioni generate da lock npm e vincoli Python, nota IT/EN che distingue baseline di build e servizi esterni. Monaco mostra la versione del motore, non del wrapper React. Rimosse le due attribuzioni improprie; regressione contro i file effettivi. |

Il controllo statico iniziale rifiutava i terminatori misti del tracker già presente. La successiva registrazione dell'audit normalizza soltanto il formato, preservando ogni nota storica e i due record aperti con i loro criteri originali.

## Versioni e decisioni sugli aggiornamenti

L'[inventario verificabile](./evidence/critical-audit-dependencies-2026-10-21.json) contiene tutte le dipendenze dirette npm e i vincoli Python con versioni installate e candidate del registro. Prima dell'intervento, gli 816 percorsi npm del lock sono stati controllati sui `package.json` reali: nessuna versione discordante fra i pacchetti presenti. L'inventario distingue pacchetti opzionali assenti e il fork locale; non equivale a un confronto di ogni byte con il tarball upstream.

| Componente | Effettiva iniziale → finale | Decisione |
| --- | --- | --- |
| Node host / npm | 24.20.0 / 11.19.0, invariati | Toolchain della postazione; non confondere con Node incorporato in Electron. |
| Python | 3.13.15, invariata | Compatibile con la wheel Pillow 13.0.0 CPython 3.13 Windows x64. |
| Electron | 43.7.4 → 43.8.3 | Backport sulla stessa linea; 44/45 richiedono valutazione separata. |
| Pillow | 12.3.0 → 13.0.0 | Aggiornamento necessario per advisory noti, anche se major. Python 3.10 rimosso upstream, fuori dal target del progetto. |
| Vite / Vitest / TypeScript | 8.2.4 / 4.1.11 / 6.0.3 | Patch editor Windows già presente; nessuna nuova correzione nota attribuita a queste versioni dallo scan npm. |
| React / React DOM | 19.2.8 / 19.2.8 | 19.3.1 disponibile: proposta funzionale separata, non aggiornamento obbligato dal solo numero di versione. |
| Monaco / DOMPurify | 0.56.0 / 3.4.17 | Mantenuta sostituzione del sanitizer nel grafo; nuova verifica Electron sui chiamanti reali. |
| braces | 3.0.4+onlyrag.1 locale | Upstream pubblica ancora 3.0.3; mantenere il task esistente. Un audit npm vuoto non dimostra corretto upstream. |
| FastAPI / Uvicorn / Pydantic | 0.141.1 / 0.52.4 / 2.13.4 | Nessun advisory noto nei risultati correnti; candidati 0.156.6 / 0.54.0 / 2.14.1 da provare separatamente sui contratti. |
| LanceDB / Arrow | 0.37.1 / 25.0.1 | Candidati 0.40.0 / 26.0.0: nessuna necessità dimostrata di cambiare il formato/storage qualificato. |
| PyMuPDF / RapidOCR / ORT GPU | 1.28.2 / 3.9.2 / 1.29.0 | Candidati 2.0 / 3.10.0 / 1.31.0; cambiamento parser/OCR/provider richiede regressioni e build CPU separata. Nessuna sostituzione automatica. |

Lo scan iniziale dell'ambiente Python del checkout comprende 70 distribuzioni. Le fonti differiscono: OSV aggiunge CVE-2026-112395 rispetto al risultato PyPI; sono conservati entrambi i JSON. La release Pillow elenca ulteriori correzioni che non si possono dedurre dal solo conteggio degli scanner. Nell'app non sono stati trovati chiamanti di PDF append Pillow, `draft`, ImageMorph, TIFF save o EPS `load(scale=...)`; i decoder TIFF restano potenzialmente raggiungibili secondo il percorso OCR e le opzioni di preprocessing. Non sono state eseguite PoC native di corruzione memoria.

Readback GitHub prima di un'eventuale pubblicazione: **36 alert aperti**, 4 critical/24 high/8 medium, nove identità advisory Pillow ripetute nei quattro manifest Python. Non sono 36 difetti applicativi indipendenti. La modifica locale non cambia il branch remoto né chiude gli alert: GitHub e gli audit locali hanno stato e perimetro diversi.

## Verifiche e limiti

Ricevute complete in `C:/Users/Utente/OnlyRag-Live/critical-audit-20261021`; sorgenti di prova copiati dai file correnti con SHA-256. npm usa un'installazione indipendente. Python di verifica possiede Pillow 13.0.0 e condivide le altre dipendenze dev tramite junction dichiarate. La prima fixture con soli file `.pth` ha fallito OCR CUDA e worker XLS isolato: ripristinati i percorsi nativi delle dipendenze, senza indebolire i test o i confini del worker; i log iniziali restano distinti dagli esiti finali.

Readback conclusivo: **2.377 file personali/configurazioni**, insieme e SHA-256 invariati fra `userdata_dev`, `%APPDATA%/onlyrag-v2` e `%LOCALAPPDATA%/OnlyRagV2`. 1.224 sorgenti corrispondono alla copia di verifica, eccetto i soli aggiornamenti finali del rapporto/inventario/tracker; codice runtime e test restano identici. Pacchetti Vite e braces confrontati per tutti i file, binario Electron confrontato per SHA-256 fra copia e checkout. I due record aperti e i criteri sono identici; `git diff` e `git status --ignored` rivisti. Le directory ignorate preesistenti sono conservate; build correnti aggiornate, nessun commit/push.

| Controllo | Esito |
| --- | --- |
| `npm run test` | 3.002 test, 328 file, zero fallimenti/skip nella suite finale. |
| `python -m pytest -p no:cacheprovider -q` | 687 passati, un caso symlink directory non disponibile sull'host saltato. |
| `npm run quality:python` | 15 casi su otto controlli obbligatori, nessuno saltato. |
| `npm run typecheck`, `npm run build` | Passati; renderer e Main/Preload compilati. |
| `npm run audit:deadcode`, `npm run audit:cycles` | Passati, normale e produzione; nessun ciclo rilevato dal comando. |
| `node scripts/e2e/uxFlows.mjs` | 11 gruppi nel runtime Electron nuovo: cinque viste, tre dimensioni desktop, zoom 100/150/200%, errori/riprova e riavvio; servizi IPC controllati. |
| `node scripts/e2e/agentReliability.mjs` | Otto scenari Electron e nove guard; backend di generazione controllato. |
| `node scripts/e2e/monacoSanitizer.mjs` | Chiamanti Monaco e configurazioni DOMPurify reali verificati in Electron nuovo. |
| `npm run quality:static`, `npm run docs:check`, `git diff --check` | 888 file, 107 handler IPC protetti, 115 documenti; formato, layering e link passati. |

Nel checkout `npm ci` termina con successo; il pacchetto Electron installa il binario alla risoluzione del suo entry point. Il primo runner aggiuntivo puntava direttamente a un `electron.exe` non ancora materializzato: corretto il runner per risolvere il pacchetto secondo il suo contratto, senza patch di `node_modules`. Il readback nativo conferma versione e componenti riportati sopra. La schermata Informazioni è verificata anche sul bundle del checkout a 1920×1080 e 1024×700, senza overflow orizzontale o errori pagina.

Audit finali del checkout: `npm audit --json` zero segnalazioni; `pip-audit==2.10.1 --path .venv/Lib/site-packages --strict` con servizi PyPI e OSV, 70 distribuzioni, zero advisory/skip in entrambi. L'ambiente dev di prova con pytest comprende 80 distribuzioni e passa entrambi gli scan. L’ambiente CPU nuovo passa PyPI e OSV su 69 distribuzioni senza advisory/skip. `pip check` passa. Le versioni delle candidate non sostituiscono questi esiti specifici; non è una verifica di ogni byte o libreria incorporata.

Build CPU Sidecar autonoma: `python -m PyInstaller --distpath ../frozen-dist --workpath ../pyinstaller-work sidecar.spec`, PyInstaller 6.22.2/Python 3.13.15. Estratti i bytecode di `PIL._version`: 13.0.0; `_imaging` coincide SHA-256 con la wheel dell'ambiente CPU. Il processo congelato posseduto usa store nuovo e token casuale: accesso senza token rifiutato, PNG/TIFF sintetici estratti con OCR CPU reale e originali invariati, due documenti indicizzati con embedding deterministici da HTTP loopback. Due richieste embedding simulate e zero generazioni reali. Arrestato il solo processo posseduto. Questa è una prova del Sidecar congelato, non di un installer Electron o del profilo personale.

Prestazioni: `python scripts/e2e/retrievalEfficiency.py --label after --chunks 100000 --samples 5 --dimension 768 --varied --contention --p95-limit-ms 5000`. 100 documenti, vettori densi sintetici e testo multilingue variabile; una lettura fredda 943 ms, p95 caldo completo 460 ms e coda non indicizzata 569 ms, arrotondati per eccesso. In contesa: quattro reader e venti scritture, sette letture riuscite con p95 1.529 ms, tredici conflitti di revisione espliciti; p95 di tutti i terminali 1.472 ms. Readback completo di righe/archivi identico. Picco cumulativo del processo al primo scenario: working set 1,69 GiB, commit 2,54 GiB, include la costruzione della fixture; non è il solo costo della ricerca. Cinque campioni per scenario non sono una stima statistica generale del p95; i conflitti non sono risultati di ricerca riusciti. Fixture conservata `C:/Users/Utente/AppData/Local/Temp/onlyrag-retrieval-after-65_tvue4/report.json`.

## Residui confermati e proposte separate

Il tracker conserva **due P2**, senza cambiarne ID, priorità o criteri: `DEPENDENCY-BRACES-UPSTREAM-01` e `DEVSERVER-LOOPBACK-PROBE-STABILITY-01`. Per il secondo la causa storica resta ignota: i successi delle sonde e delle guardie non ne dimostrano la risoluzione. I residui operativi P3 di pulizie rifiutate nelle sessioni precedenti restano conservati nelle note; nessun nuovo tentativo di rimozione o task ritirato riattivato.

Interventi ulteriori proposti, non difetti aggiuntivi dimostrati: allineare la toolchain host Node alla 24.22 e i tipi Node alla linea runtime; aggiornare separatamente React/virtualizzazione, Vite/Vitest e strumenti di analisi; valutare storage/Arrow/PyMuPDF/OCR con i propri carichi e contratti. La modifica di installazioni globali, il passaggio Electron 44/45 e la consegna di un nuovo installer non fanno parte di questo lotto. I candidati conservati precedenti mantengono le proprie versioni; non sono stati sovrascritti o dichiarati corretti.

Audit selettivo, non analisi esaustiva di tutte le combinazioni e di tutti i parser. Non verificati: modelli personali o qualità semantica, perdita di alimentazione, sicurezza di ogni libreria nativa incorporata, fuzzing dei formati, attaccante locale con gli stessi privilegi dell'utente, dispositivi/GPU diversi e pubblicazione/installazione personale. I controlli IPC, sandbox, navigazione, autenticazione Sidecar, SSRF e filesystem sono stati letti e coperti dai gate dichiarati; questi controlli non certificano assenza di vulnerabilità o difetti.

## Fonti primarie consultate

- [Electron 43.8.3](https://github.com/electron/electron/releases/tag/v43.8.3), [43.8.0 e aggiornamento Node](https://github.com/electron/electron/releases/tag/v43.8.0), [sicurezza al tag 43.8.3](https://github.com/electron/electron/blob/v43.8.3/docs/tutorial/security.md).
- [Pillow 13.0.0: sicurezza e incompatibilità](https://pillow.readthedocs.io/en/stable/releasenotes/13.0.0.html), [metadati e wheel della release](https://pypi.org/pypi/pillow/13.0.0/json), [advisory JPEG](https://github.com/python-pillow/Pillow/security/advisories/GHSA-8g5g-8vmr-9782), [advisory TIFF](https://github.com/python-pillow/Pillow/security/advisories/GHSA-c6hw-5grf-ff96).
- [Stream Node 24.20.0](https://nodejs.org/download/release/v24.20.0/docs/api/stream.html#readablesetencodingencoding): decodifica dei caratteri multibyte attraverso chunk; [HTTP Node 24](https://nodejs.org/docs/latest-v24.x/api/http.html): errori e terminazione delle risposte.
- [Modello di sicurezza e uso di pip-audit](https://github.com/pypa/pip-audit/blob/main/README.md), [database PyPA](https://github.com/pypa/advisory-database), [OSV](https://osv.dev/docs/), [registro npm braces](https://registry.npmjs.org/braces/latest).
- [FastAPI 0.141.1](https://pypi.org/pypi/fastapi/0.141.1/json), [LanceDB 0.37.1](https://pypi.org/pypi/lancedb/0.37.1/json); le candidate del registro sono solo proposte, non compatibilità applicativa già dimostrata.

Residuo operativo finale **P3**: `C:/Users/Utente/OnlyRag-Live/critical-audit-20261021/pyinstaller-work` conservato. La revisione automatica ha rifiutato il comando combinato PowerShell di pulizia prima dell’esecuzione con `blocked by policy`, senza ulteriore motivo. Nessuna fase eseguita o rimozione alternativa tentata; ricevuta `cleanup-rejection.json`. Non è un difetto applicativo o la riattivazione di un task di smaltimento ritirato. Snapshot sorgenti, ambienti di verifica, profili sintetici, artefatti congelati e ricevute sono intenzionalmente conservati fuori dal checkout.
