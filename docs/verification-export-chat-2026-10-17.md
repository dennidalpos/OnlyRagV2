# Export e contesto chat — 17 ottobre 2026

Lotto autorizzato: HTML letterale, destinazioni export senza collisioni, conservazione del codice DOCX a fine documento e budget chat legato al modello effettivo. I punti su documenti grandi, memoria XLS, encoder dello storico e copertura documentale restano aperti nel tracker; nessuna migrazione, nuova dipendenza, installazione o generazione reale.

## Comportamento e completamento

| Flusso | Correzione e criterio verificato |
| --- | --- |
| HTML e alias HTM | Il contenuto nel `pre` passa da `html.escape`: tag, attributi, entità già codificate e Unicode restano testo, senza elementi attivi introdotti dal documento. Il formato resta testuale. |
| Export automatico nel Main | Nome con UUID e creazione esclusiva `wx`, flush e chiusura prima della conferma. Ogni collisione genera un altro nome; dopo tre tentativi il risultato è un errore. Errori diversi non vengono ritentati. Un fallimento elimina soltanto il parziale ancora identificato come quello creato dall'operazione; un parziale non eliminabile non viene presentato come successo. |
| Rendering Sidecar | Ogni richiesta riceve una directory esclusiva sotto `data/exports`; due richieste con lo stesso timestamp non condividono il file. `file_path`, `file_name`, base64 e gli altri campi REST restano presenti. Le directory già esistenti non vengono ripulite; un rendering fallito può lasciare il proprio artefatto incompleto isolato. |
| Dialogo Salva | La destinazione scelta esplicitamente conserva la sostituzione tramite writer temporaneo esistente. Annullamento, conversione fallita e scrittura rifiutata non producono una conferma o apertura della cartella. |
| DOCX | Lo stesso svuotamento del buffer viene usato al delimitatore finale e a fine documento. Codice Unicode, blocchi chiusi/aperti/vuoti e ordine rispetto alle tabelle sono coperti da lettura nativa del DOCX. |
| Chat | Modello del router, budget e opzione thinking vengono acquisiti prima del checkpoint asincrono. Estratti, storico e `num_ctx` usano preferenze e massimo noto di quel modello; una modifica delle impostazioni durante il retrieval vale per il turno successivo. |

Non cambiano contratti pubblici IPC/REST, schema dello storico o formati persistenti. Il budget rimane una stima in caratteri: questo lotto non qualifica la tokenizzazione effettiva.

## Regressioni ed esecuzione

Le regressioni aggiunte prima delle correzioni hanno rilevato HTML attivo, collisioni in tutti i formati, perdita del codice DOCX aperto e invio di `num_ctx=4096` al modello medico configurato a 2048. La prima fixture legale aveva metriche incomplete e si fermava nella policy thinking: corretta aggiungendo le capacità richieste dal tipo reale, prima della verifica finale.

- Test mirati iniziali dopo la correzione: 75 TypeScript e 14 Python passati. Coprono anche collisioni native forzate, limite di tre tentativi, errori di scrittura/flush, chiusura del descrittore, conservazione degli export precedenti e stabilità del turno durante un cambio impostazioni.
- `node scripts/e2e/exportChatReliability.mjs`: passato. Main, Preload, handler export e Sidecar reali, profili temporanei separati, Sidecar autenticato su porta assegnata dal sistema. Dieci export distinti MD/PDF/DOCX/HTML/HTM, lettura dei contenuti PDF/DOCX, HTML inerte, sostituzione deliberata, annullamento e rifiuto della scrittura. Chat Renderer reale a 1920×1080 con trasporto modello simulato: medico 2048, legale limitato al massimo noto 3072, generale 4096.
- `node scripts/e2e/chatDraftRecovery.mjs`: passato. Recupero della risposta incompleta dopo interruzione forzata del processo isolato, revisione originale della bozza, rifiuto della chiusura, retry e readback al riavvio.

Il comando ripetibile `npm run test:e2e:export-chat` include la build. La sonda reindirizza soltanto il trasporto Sidecar verso il processo isolato e simula il trasporto Ollama; gli handler export e il controllo del mittente restano quelli di produzione. Non avvia il Sidecar personale e non contatta modelli reali.

| Comando finale | Esito |
| --- | --- |
| `npm run test -- --reporter=dot --silent=true` | 2.884 test passati, 320 file, 204,43 s. |
| `.venv\Scripts\python.exe -m pytest -q` | Verifica pre-commit: 551 passati e un caso symlink saltato, 119,90 s; inclusi tutti i 14 casi del nuovo file. La prima esecuzione aveva raccolto 550 casi passati prima dell'aggiunta dell'ultimo test. |
| `.venv\Scripts\python.exe -m pytest -q sidecar/tests/test_exporter.py` | 14 passati, incluso il fallimento dopo scrittura parziale con export precedente integro. |
| `npm run build` | TypeScript e bundle Renderer/Main/Preload passati. |
| `npm run typecheck` | Passato. |
| `npm run quality:static` | Passato su 850 file; 103 handler IPC e guard di layering invariati. |
| `npm run docs:check` | Passato su 62 pagine Markdown. |
| `git diff --check` | Passato. |

Rivisto il diff del lotto; modifiche preesistenti a direttive, tracker e documentazione conservate. Dossier SecondBrain aggiornato con sessione Write registrata, backup e readback verificati; sessioni Read/Write chiuse. Nessuna attività rimossa o aggiunta al tracker.

Le prime due esecuzioni della nuova sonda sono conservate: `C:\Users\Utente\AppData\Local\Temp\onlyrag-export-chat-7DtFD1` (stdout Python cp1252 incapace di stampare CJK; lettura corretta usando UTF-8 esplicito) e `C:\Users\Utente\AppData\Local\Temp\onlyrag-export-chat-RbX1Ql` (fixture streaming conclusa prima della consegna del chunk; corretto l'ordine temporale della fixture). La terza esecuzione passa; nessuna modifica applicativa è stata necessaria per questi due problemi di sonda.

## Fonti e limiti

API controllate nella documentazione ufficiale e tramite test sui runtime locali Node 24.20.0/Python 3.13.15: [escape HTML](https://docs.python.org/3.13/library/html.html#html.escape), [directory temporanee esclusive](https://docs.python.org/3.13/library/tempfile.html#tempfile.mkdtemp), [creazione esclusiva Node](https://nodejs.org/docs/latest-v24.x/api/fs.html#file-system-flags). Le pagine correnti della serie 3.13 e 24.x mostrano patch successive; la compatibilità locale è sostenuta dai test eseguiti, non dalla sola pagina corrente. [CommonMark](https://spec.commonmark.org/0.31.2/#fenced-code-blocks) definisce la chiusura del blocco codice a fine documento; non si introduce un parser Markdown completo.

Non qualificati: app installata, perdita di alimentazione, qualità semantica e modelli reali. Commit e push richiesti esplicitamente dopo la prima verifica del lotto. Il residuo della sonda di analisi precedente `C:\Users\Utente\AppData\Local\Temp\onlyrag-audit-history-wvp917cr`, la cui pulizia era stata respinta dal controllo automatico, non è stato toccato.
