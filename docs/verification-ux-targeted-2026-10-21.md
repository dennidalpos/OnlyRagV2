# Correzioni UX/UI mirate — 21 ottobre 2026

## Perimetro ed evidenze

Implementazione del piano approvato: conservare l'impianto visivo e richiedere una scelta esplicita quando manca il modello. Target Windows desktop, Electron 43.7.4; dimensioni finestra 1920×1080, 1400×900 e 1024×700, zoom applicativo 100/150/200%. Tablet, smartphone e addin non fanno parte del prodotto.

L'osservazione iniziale ha usato Electron con profilo sintetico e Sidecar disabilitato. Le verifiche successive eseguono Renderer, Main e Preload della build corrente, sostituendo in Main i servizi IPC con risposte controllate. Non attestano parser, qualità dei modelli, rendering PDF/DOCX esportato o app installata. Nessuna inferenza reale, download di modelli, modifica di configurazioni personali, commit o push.

## Rilievi, riproduzione e correzioni

| Priorità | Schermata/componente | Evidenza e riproduzione | Impatto e correzione applicata |
|---|---|---|---|
| P2 | Ingestione, Contesto Chat, Traduzione Markdown/PDF/DOCX | Osservato: avvio con Sidecar offline mostrava istruzioni per un archivio vuoto. | Confusione fra indisponibilità e assenza dati. Stato esplicito di caricamento/errore, Riprova e avviso per dati precedenti; vuoto soltanto dopo risposta valida. Documenti e selezioni conservati durante l'errore. |
| P2 | Diagnostica e selettori modello | Osservato e confermato dal codice: profilo senza assegnazioni, primo modello installato `bge-m3` assegnato ai moduli generativi. | Possibile avvio con ruolo sbagliato. Diagnostica senza scritture di assegnazione; avviso e selettore esplicito, avvio bloccato senza modello. Le scelte già salvate restano conservate. |
| P2 | Composer Chat | Rilievo statico iniziale, poi provato in Electron: input monoriga con promessa Shift+Invio. | Composizione incoerente. Textarea, Shift+Invio per nuova riga, Invio per un solo invio, composizione IME protetta. Senza modello Invio conserva il testo. |
| P2 | Schede Chat, Traduzione e Coding | Rilievo statico iniziale, poi provato con frecce, Home/End e albero DOM. | Navigazione tastiera incoerente. Tab stop sulla selezione, attivazione da tastiera e pannelli nominati; interruttori fuori dal tablist. Il ripristino del composer non sottrae più focus durante la navigazione. |
| P2 | Copia messaggi/citazioni Chat | Rilievo statico, poi clipboard rifiutata e riprova in Electron. | Conferma di successo anticipata. Attesa dell'esito, icona/successo solo dopo conferma; errore visibile con riprova dal medesimo pulsante. |
| P3 | Saluto Chat, conteggio PDF/DOCX, Impostazioni | Osservati saluto inglese in italiano, `0 Documentos`, ordine delle sezioni 1/2/3/5/4. | Testi incoerenti. Nuovi saluti IT/EN, plurali del catalogo e ordine 1/2/3/4/5. Nessuna riscrittura dello storico. |
| P2 | Wizard Hardware e Modelli | Confermato dal codice: Escape/X passavano dal salvataggio delle raccomandazioni. Provato dopo riavvio con profilo senza modello. | Scelta implicita alla chiusura. Escape/X/backdrop chiudono senza applicare le raccomandazioni; Salva ed esci e conferma finale restano azioni esplicite. |
| P2 | Barre e pannelli con zoom | Osservati controlli tagliati nelle catture iniziali; assert sui controlli principali al 200%. | Controlli irraggiungibili. Barre con wrapping, pannelli restringibili/scorrevoli e disposizione verticale delle aree a spazio ridotto. Navigazione laterale scorrevole. |
| P2 | Editor Monaco e vista differenze | Osservati errori Renderer durante il cambio rapido delle viste: bootstrap worker `data:` e modello diff eliminato prima del distacco. | Degrado delle funzioni editor/diff e errori non gestiti. Worker Vite espliciti secondo gli export Monaco 0.56; wrapper diff che distacca e poi dispone i modelli durante la chiusura. Prova finale senza errori pagina. |

I messaggi operativi restano visibili. Gli aiuti continuano a usare Tooltip e il catalogo condiviso. Nessuna modifica ai contratti IPC/REST o ai formati persistenti; cambia soltanto l'interfaccia interna degli hook e dei componenti Renderer.

## Verifiche ripetibili

- `npm run test:ux`: build e prova deterministica dei flussi. Copre selezione file e ingestione simulate con progresso/errore/riprova/completamento; indisponibilità iniziale, caricamento, vuoto verificato, conservazione dati e recupero; scelta modello e riavvio; multilinea/IME; clipboard messaggio/citazione; tastiera; traduzione controllata con progresso, annullamento, errore, riprova, completamento ed acknowledgement export. I controlli di export sostituiscono il servizio: non generano un documento reale.
- Il runner copre cinque viste nelle nove combinazioni di dimensioni e zoom. Verifica assenza di overflow della finestra e raggiungibilità dei controlli principali dopo scorrimento; non equivale a una scansione geometrica di ogni elemento. Le catture native `webContents.capturePage()` evitano il ritaglio prodotto da Page.screenshot con lo zoom. Ispezionate immagini rappresentative di Chat, Ingestione, Traduzione e Coding, comprese quelle al 200%.
- `npm run test:tooltips`: fixture Electron con componenti reali, descrizioni accessibili, hover/focus, albero accessibile, bordi, modali sovrapposti, Tab/Shift+Tab, primo Escape al tooltip e ripristino focus. Eseguita a tre dimensioni e tre zoom; il wizard reale è provato anche dopo riavvio nel runner UX.
- Suite TypeScript completa: 2977 test, 326 file, nessun fallimento. Typecheck, build, statico (884 file/107 handler IPC), Knip normale/produzione e cicli passano.
- Suite Python con venv di sviluppo esistente: 666 passati, un caso saltato perché l'host non consente symlink di directory. Gate critico: 15 passati senza skip. Il `.venv` del checkout non contiene pytest: il comando ordinario fallisce prima della raccolta. Verifica eseguita con il venv già referenziato dalla precedente copia di sviluppo, senza installare o alterare dipendenze.

Per cambiare le dimensioni della fixture tooltip usare `ONLYRAG_TOOLTIP_WIDTH` e `ONLYRAG_TOOLTIP_HEIGHT`; `ONLYRAG_TOOLTIP_EVIDENCE` sceglie la cartella delle prove. `ONLYRAG_UX_EVIDENCE` seleziona quella dei flussi; usare una nuova directory per una prima esecuzione, perché il runner conserva intenzionalmente il profilo per verificare il riavvio.

Evidenze fuori dal checkout: `C:/Users/Utente/OnlyRag-Live/ux-targeted-20261021-final-ingest` (report e catture); `ux-targeted-20261021-tooltips-stack-1920`, `-1400`, `-1024` (otto gruppi per esecuzione); `ux-targeted-20261021-vitest-final2.json`, `ux-targeted-20261021-python.log` e `ux-targeted-20261021-build-final.log`. Tentativi intermedi `ux-targeted-20261021-run*` conservati: includono errori delle asserzioni/fixture e difetti che hanno guidato le correzioni, senza presentarli come prove riuscite.

## Residui e limiti

- P3 operativo, profilo temporaneo della prima ispezione: `%TEMP%/onlyrag-ux-plan-d346ce0c101c4ab2822d6bf8906eab3c` esiste ancora. Il comando combinato di arresto/pulizia è stato rifiutato dalla revisione automatica prima dell'esecuzione con `blocked by policy`, senza ulteriori motivi. Nessun metodo alternativo di cancellazione. Al controllo finale i precedenti PID 4080/28352 non risultavano più attivi; il profilo resta inventariato nelle note del tracker.
- Non eseguiti installer, screen reader reali, parser/OCR reali, generazioni/embedding reali o verifica visiva dei file esportati. Questi limiti non sono nuovi difetti applicativi né riattivano campagne ritirate. La prova dei servizi IPC controllati è distinta dal funzionamento reale end-to-end.
- L'attività esistente `MODAL-ASSISTIVE-TECHNOLOGY-QUALIFICATION-01` è conclusa dalle verifiche automatizzate previste e rimossa dall'elenco dei soli aperti. Non si creano duplicati per correzioni concluse o miglioramenti facoltativi. Gli altri dieci ID e criteri restano invariati.

Riferimenti tecnici: [WAI-ARIA Tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/), [integrazione ESM Monaco/Vite](https://github.com/microsoft/monaco-editor/blob/main/docs/integrate-esm.md), [API ITextModel](https://microsoft.github.io/monaco-editor/typedoc/interfaces/editor_editor_api.editor.ITextModel.html). Percorsi worker e ordine di distacco verificati anche sul pacchetto Monaco 0.56.0 installato; la documentazione corrente da sola non certifica altre versioni.

Dossier SecondBrain aggiornato in sessione Write con backup e readback SHA-256; Sync conclusa su 23 repository con zero modifiche alle direttive e zero segnalazioni. Sessione rilasciata in `finally`. Nessuna archiviazione eseguita a seguito delle proposte del monitor.
