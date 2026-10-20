# Valutazione del chunking strutturale — 20 ottobre 2026

`RAG-STRUCTURE-AWARE-CHUNKING-01` concluso come valutazione. **Decisione: rifiutare il candidato a blocchi; nessuna integrazione nel runtime.** Non offre miglioramenti sul corpus congelato e la conservazione atomica di tabelle/code block troppo lunghi richiederebbe un gate ulteriore. La baseline rimane quella esistente.

Prima dell'esecuzione sono fissati: stessi otto file originali e query/aspettative del corpus `content-acceptance-it-en.json`, stesso encoder Nomic reale, ruoli document/query e preparazione, top tre, due store nuovi, zero normalizzazione. La baseline è il chunker header-aware corrente. L'unico candidato preserva linee complete senza overlap e blocchi di tabella/codice atomici; le righe di prosa troppo lunghe usano il limite corrente 800 caratteri/100 overlap. Nessun testo originale, aspettativa o sorgente applicativo viene riscritto. La sostituzione del solo splitter vive nel processo del benchmark.

| Misura | Baseline | Candidato |
| --- | ---: | ---: |
| Chunk | 21 | 21 |
| Corpo massimo, caratteri | 797 | 779 |
| Passaggi attesi in top tre, intero archivio | 9/11 | 9/11 |
| Rank del difetto descritto in inglese | 19 | 19 |
| Rank del preavviso annuale | 4 | 4 |
| Pagina 6 della pompa | 1 | 1 |
| Tutti i rank attesi | identici | identici |

I due passaggi mancanti restano fuori dalla shortlist; non si promuove il successo della ricerca filtrata a qualità globale. Originali e corpus hanno gli stessi hash nelle due varianti. Le prove di provenienza original/derived restano nel risultato; il candidato non cambia il contratto di citazione, né i fallimenti semantici della chat. Le due varianti usano encoder reale senza fallback nello stesso spazio versionato.

Esecuzione: `.venv\Scripts\python.exe -B scripts/live/structureChunking.py --campaign <campagna-congelata> --output <nuova-directory> --variant baseline`, poi variante `blocks`, entrambi **exit 0**. La [ricevuta JSON](./verification-structure-chunking-2026-10-20.json) conserva output, hash e criteri originali. Evidenze complete in `C:/Users/Utente/AppData/Local/Temp/onlyrag-next-tasks-c9663097cc8849fea2f65670b710293e/chunk-baseline` e `chunk-blocks`; i dati non sono eliminati.

Decisione tecnica del valutatore: nessun beneficio misurato per giustificare una modifica del runtime o una migrazione. Non è un rigetto di qualsiasi algoritmo strutturale futuro. La qualità di retrieval e risposte resta nel task P1 esistente, senza cambiare i suoi gate.
