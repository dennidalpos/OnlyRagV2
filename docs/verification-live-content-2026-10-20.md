# Qualifica dei contenuti con modelli locali — 20 ottobre 2026

Seguito: [preparazione offline del confronto sulla lingua](./plan-chat-language-2026-10-20.md). La copia durevole della campagna è stata ritrovata e verificata; nessuna nuova inferenza o modifica degli esiti seguenti. Il proprietario ha confermato il perimetro solo offline e il candidato non è integrato.

`QUALITY-CONTENT-LIVE-QUALIFICATION-01` **rimane aperto**. La raccolta reale sul corpus congelato è completa, ma il gate restituisce **exit 1 / passed false**. Nessuna aspettativa o soglia viene modificata.

| Criterio | Risultato |
| --- | ---: |
| Estrazione critica / originali invariati | 8/8 |
| Dense recall@1 / recall@3 | 7/11 / 9/11 |
| Passaggi globali in top tre / ricerca filtrata | 9/11 / 11/11 |
| Contenuto delle risposte | 10/12 |
| Lingua richiesta | 5/12 |
| Citazioni immediate e supportate | 10/12 |
| Risposte con tutti i criteri superati | 5/12 |
| Normalizzazioni reali valutate / accettazioni non sicure | 2/2 / 0 |

Sono usati i digest reali di `qwen3.5:9b`, thinking disattivato, contesto 4096, e `nomic-embed-text:latest` con `nomic-search-v1`; runtime e wire sono conservati nella preparazione. Corpus invariato, SHA-256 `f5cbfc6f22c86724583bdd2408dd379e16cc677e79f193e83856c2b2019301dc`. Il giudizio confronta fonti, aspettative e output mediante il valutatore Codex; il modello Qwen valutato non assegna i propri punteggi.

Sette risposte richieste in inglese arrivano in italiano. CSV e codice preservano i dati ma non citano il passaggio. La pompa non conserva tutti i vincoli di pagina 6; il confronto delle politiche non ripete il trigger ricezione fattura per il secondo termine. Il recupero globale perde la parafrasi del difetto (rank 19) e il preavviso annuale (rank 4), sebbene entrino nella ricerca filtrata. Le normalizzazioni reali sono semanticamente fedeli, ma violano la policy whitespace-only fondendo parole, rimuovendo un trattino o correggendo un accento: il rifiuto conservativo è corretto e non autorizza una policy diversa.

Il primo tentativo è conservato: il vecchio runner non implementava `loadChatRecovery`/`saveChatRecovery`, quindi il hook rifiutava il dispatch. Ora usa `ChatHistoryRepository` reale su directory isolate per caso, attende `historyReady` e mantiene i checkpoint con readback. La seconda raccolta passa 12 richieste/risposte (**80,10 s**), poi il giudizio e il gate separato falliscono. Raccolta riuscita e accettazione sono risultati distinti.

Nel nuovo runner installato è emerso un disallineamento IPC: `taskId` era opzionale nel tipo ma obbligatorio nello schema runtime. Il tipo ora lo richiede; verifica di tipo e casi schema concordano. Typecheck e **63 test mirati/5 file** passano. La correzione statica non indebolisce il validatore né cambia l'azione confezionata. Lo snapshot sorgente del candidato precede questa correzione di tipo e i nuovi runner e non viene riscritto retroattivamente.

Comandi: `npm run test:live -- scripts/live/contentAcceptance.live.ts --reporter=dot`, poi `.venv\Scripts\python.exe scripts/live/contentAcceptanceReview.py <campagna>`. [Ricevuta, giudizi e hash](./verification-live-content-2026-10-20.json). Campagne complete e fallite in `C:/Users/Utente/AppData/Local/Temp/onlyrag-next-tasks-c9663097cc8849fea2f65670b710293e/live`; dati personali e aspettative congelate preservati.

I residui rimangono nel task P1 esistente: risposte multilingue, condizioni, citazioni e retrieval globale. Il [candidato di chunking](./verification-structure-chunking-2026-10-20.md) è rifiutato e non li risolve. Ruoli/modelli più ampi, desktop con generazione, hardware e altre campagne restano da qualificare.
