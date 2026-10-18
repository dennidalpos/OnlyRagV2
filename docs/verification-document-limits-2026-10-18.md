# Limiti documentali e recupero Markdown — 18 ottobre 2026

Lotto `DOC-LARGE-EXTRACTION-REVIEW-01`, autorizzato con «implementa tutto il possibile» dopo la riproduzione del disallineamento. Il perimetro mantiene la soglia esistente, ne rende esplicita l'unità UTF-16 e conserva recuperabilità e originali. Non estende il supporto dell'editor o delle conversioni a documenti arbitrariamente grandi.

## Contratti e criteri di completamento

| Ambito | Comportamento e prova |
| --- | --- |
| Soglia comune | Massimo 10.000.000 di unità UTF-16 per nuova ingestion, aggiornamento, revisione, singolo testo della bozza e conversione PDF/DOCX/HTML/HTM. Test sui contratti reali Python e TypeScript sotto, sulla e sopra soglia, con ASCII e caratteri astrali. Le stringhe ammesse restano integrali. |
| Ammissione prima dell'indice | Si controllano Markdown assemblato con intestazioni, risultato sanitizzato e archivio originale prima di creare chunk o richiedere embedding. PDF oltre 10.000 pagine rifiutati prima del rendering. Il rifiuto non scrive documento/chunk e non cambia gli originali. |
| Revisione | Un originale o un elenco di motivi oltre i limiti produce un rifiuto dimensionale esplicito, anziché un payload di revisione che il Main scarterebbe come malformato. Nessun troncamento e nessuna indicizzazione del risultato rifiutato. |
| Recupero | Lettura dei record canonici preesistenti e lettura degli archivi già presenti mantengono i contratti precedenti. Solo l'export Markdown locale è esentato dalla soglia di modifica/conversione: scrive il testo completo senza parser o trasporto Sidecar. Contratti IPC stretti su formato e destinazione restano attivi. |
| Editor e bozze | Il banner segnala il testo oltre soglia e offre Markdown; pulsante e scorciatoia Salva non inviano aggiornamenti fuori limite. Il testo resta disponibile per riduzione esplicita o recupero. Le bozze oltre soglia rifiutano il flush e mantengono il blocco di chiusura esistente; un export non riconosce il salvataggio canonico. Per una bozza ridotta di un documento preesistente enorme si conserva la revisione originale, senza duplicarne la base fuori limite nell'archivio bozze. |
| REST | Richieste non ammissibili rifiutate dallo schema. Un risultato della sanitizzazione fuori limite restituisce 413 durante l'aggiornamento, prima dell'embedding. OpenAPI rigenerato in una radice temporanea isolata e confrontato con il runtime. |

L'archivio originale viene ora validato e salvato prima della preparazione dell'indice. Un fallimento successivo può conservare la copia del task non indicizzato: non si introduce pulizia automatica degli archivi preesistenti o dei residui. La relativa politica resta in `SOURCE-ARCHIVE-LIFECYCLE-01`.

## Verifica eseguita

- Contratti a **9.999.999, 10.000.000 e 10.000.001 unità**, sia ASCII sia Unicode astrale. La matrice include risultato d'ingestione, aggiornamento, revisione, bozze, tutti i formati di conversione, lettura canonica e recupero Markdown.
- Pipeline Python con estrazione, sanitizzazione, chunking, LanceDB, REST ed export HTML reali su una soglia di prova ridotta a 128 unità: confini comprensivi delle intestazioni, testo completo riletto, originali e documento precedente invariati. Gli embedding sono il fixture deterministico dichiarato nel conftest; non sono modelli reali. La prova ridotta non misura il costo di indicizzare dieci milioni di caratteri.
- Rifiuto dell'archivio originale enorme anche con risultato finale piccolo; rifiuto del risultato sanitizzato troppo lungo; revisione enorme rifiutata senza payload invalido e senza entrare nel chunking.
- Hook React reali: bozza enorme conservata in memoria ed esportabile, salvataggio e conversione rifiutati, flush rifiutato fino alla riduzione esplicita, revisione originale di una base preesistente enorme conservata. Test del banner, azione Markdown e scorciatoia.
- Prova Electron aggiornata in `scripts/e2e/exportChatReliability.mjs`: Renderer, Main, Preload e Sidecar autenticato reali in radici temporanee, esportazione di **5.000.001 emoji più riga finale** in Markdown, dimensione UTF-8 e SHA-256 riletti dal filesystem. Conversioni fuori limite rifiutate dal vero IPC prima di qualsiasi richiesta Sidecar; tutti i dieci export precedenti restano identici.

| Comando | Esito |
| --- | --- |
| `npx vitest run electron/core/domain/sidecarContract.test.ts electron/core/application/sidecarAppService.test.ts src/hooks/useIngestionDocumentMarkdown.test.tsx src/components/ingestion/IngestionView.test.tsx --reporter=dot --silent=true` | 73 test passati. |
| `.venv\Scripts\python.exe -B -m pytest -q -rs --tb=short -p no:cacheprovider` sui sei file document limits, source provenance, normalization ingestion, document recovery, contracts e OpenAPI | 66 passati e un symlink saltato. |
| `npm run build` | TypeScript, Renderer, Main e Preload passati. |
| `node scripts/e2e/exportChatReliability.mjs` | Passato: recupero enorme con rilettura SHA-256, rifiuti prima del Sidecar e regressioni precedenti export/chat. |
| `npm run quality:static` | Passato su 851 file e 103 handler IPC. |
| `node scripts/e2e/chatDraftRecovery.mjs` | Passato: recupero dopo interruzione forzata, revisione originale, chiusura rifiutata su scrittura fallita, retry e readback al riavvio. |
| `npm run test -- --reporter=dot --silent=true` | 2.890 passati in 320 file, 192,12 s. |
| `.venv\Scripts\python.exe -B -m pytest -q -rs --tb=short -p no:cacheprovider` | Suite completa: 568 passati e un symlink saltato, 134,32 s. La verifica mirata finale include anche l'asserzione HTTP 413 aggiunta successivamente al medesimo test della sanitizzazione. |
| `npm run docs:check` | Passato su 64 pagine Markdown. |
| `git diff --check` | Passato. |
| `.venv\Scripts\python.exe -B -m pytest -q -rs --tb=short -p no:cacheprovider sidecar/tests/test_document_limits.py` | Verifica finale: 16 passati, 6,05 s; include anche il rifiuto HTTP 413 del risultato sanitizzato. |

Il task è concluso per i criteri di ammissione e recupero descritti e rimosso dal tracker degli aperti, senza creare duplicati. Il confronto con la copia precedente al lotto mostra soltanto questa rimozione, preservando schema, note e tutte le altre voci: 24 autonome e 18 con decisione utente. Le qualifiche ulteriori elencate sotto mantengono il proprio task esistente.

Nelle prime fixture Python il confronto dell'HTML non considerava CRLF di Windows e la punteggiatura scelta veniva normalizzata da ftfy senza espandersi. Corrette le aspettative: HTML riletto come contenuto testuale con newline normalizzati, e output del sanitizzatore esplicitamente fuori soglia nel caso che ne verifica la postcondizione. Non sono state necessarie correzioni applicative per questi due problemi di fixture. Il lint ha inoltre richiesto di verificare esplicitamente la presenza del pulsante nel nuovo test UI, evitando un optional chaining non sicuro.

## Fonti, recupero e limiti

API confrontate con [validatori Pydantic](https://docs.pydantic.dev/latest/concepts/validators/), [Zod](https://zod.dev/api#strings), [stringhe Python](https://docs.python.org/3.13/library/stdtypes.html#text-sequence-type-str) ed [ECMAScript](https://tc39.es/ecma262/multipage/ecmascript-data-types-and-values.html#sec-ecmascript-language-types-string-type). Runtime locali: Python 3.13.15, Pydantic 2.13.4, Node 24.20.0, Zod 4.4.3. La documentazione Zod corrente descrive 4.6 e conta code point; non prova il comportamento di 4.4.3. Il contratto introdotto usa esplicitamente `text.length`, con regressioni sul runtime installato, senza dipendere dalla semantica futura di `z.string().max`.

Backup del checkout precedente al lotto in `%TEMP%/onlyrag-document-limits-backup-5f366ee7bf0d496689f68cc2d3209358`, con confronto SHA-256 delle copie; comprende le modifiche locali preesistenti nei file interessati. I dati personali e gli archivi persistenti esterni al fixture non sono stati modificati. Nessuna nuova dipendenza, migrazione, installazione, chiamata a modelli reali, commit o push.

Dossier SecondBrain aggiornato con sessione Write registrata, backup del contesto e readback verificati. Le precedenti evidenze del lotto junction e il riallineamento desktop sono conservati; nessun aggiornamento agli snapshot o alle memorie private dell'IDE.

Queste prove qualificano ammissione e recupero nei casi dichiarati, non un tetto universale di memoria, la fluidità dell'editor con qualunque testo enorme, il layout visivo di ogni conversione o l'app installata. Le qualifiche di memoria XLS, persistenza installata, qualità semantica e ciclo di vita degli archivi restano aperte.
