# Embedding, indice e ricerca

La provenienza dei vettori e la ricerca sono implementate in [`embeddings.py`](../sidecar/infrastructure/embeddings.py), [`chunk_storage.py`](../sidecar/infrastructure/chunk_storage.py), [`search_service.py`](../sidecar/services/search_service.py) e [`db.py`](../sidecar/infrastructure/db.py). REST e tipi rimangono in [`api-rest.md`](./api-rest.md).

## Invarianti

- Ogni spazio nativo conserva modello, digest, dimensione, normalizzazione e preparazione. Documento e query devono usare la stessa identità completa. Gli indici legacy senza provenienza non ricevono un'identità presunta; un cambio di modello o preparazione richiede un rebuild verificato.
- Nomic usa prefissi diversi per documento e query; Qwen usa un'istruzione sulla query; BGE-M3 e lo spazio hash mantengono testo raw. Solo errori di trasporto dell'encoder possono produrre il fallback hash, in uno spazio distinto.
- La ricerca combina candidati densi e BM25 nativo, applica il filtro documento e ordina con RRF e segnali lessicali. Il punteggio è un ordine di ranking, non una probabilità di correttezza né una prova che una risposta sia supportata.
- La codifica della query avviene fuori dal lock del database, lasciando disponibili health e letture. Prima della ricerca vengono ricontrollate versioni delle tabelle e provenienza degli encoder: un cambiamento restituisce un conflitto esplicito, senza usare lo snapshot superato.
- La navigazione di una fonte verifica ID, revisioni, span e hash dell'originale. Una posizione valida non certifica la verità della frase generata.
- Per i risultati di una ricerca, archivio e revisione canonica vengono letti e verificati una sola volta per documento. I risultati mantengono ordine e identità; la richiesta successiva rilegge i dati, compresi archivi prima assenti o modificati. Non esiste una cache persistente della provenienza.
- Il rebuild offline richiede una radice dichiarata, backup/readback e attivazione esplicita tramite `data/active-store.json`; non migra automaticamente profili personali. Comandi e rifiuti sono in [`operations.md`](./operations.md).

## Ciclo di vita degli archivi originali

Ogni ingestione conserva una copia dell'originale e la prima estrazione in `data/source-documents/<doc_id>`, distinti anche quando i nomi dei file coincidono. La revisione del Markdown cambia documento e chunk indicizzati, conservando originali ed estrazione immutabili. Un riferimento della revisione superata viene rifiutato; il testo riscritto senza uno span originale verificabile resta derivato.

La cancellazione di un documento rimuove il record e i chunk dall'indice e rende indisponibili le sue vecchie citazioni. L'archivio originale viene conservato, anche ripetendo la cancellazione. Un'estrazione fallita può lasciare un originale non indicizzato: questo residuo rimane conservato e non diventa una fonte navigabile. La manutenzione ordinaria non lo promuove o elimina automaticamente.

L'annullamento tenta prima il rollback dei dati della nuova ingestione, poi rimuove soltanto l'archivio rivendicato da quel task. Il cleanup rifiuta proprietario/percorso incompatibile, traversal, junction e artefatti inattesi prima di eliminare i file. Un errore di pulizia o rollback mantiene il relativo errore e i dati da recuperare. Lo smaltimento degli archivi conservati richiede la decisione separata già presente nel tracker; la cancellazione dall'indice non autorizza una purga.

[Qualifica del ciclo completo, citazioni superstiti e confini della pulizia](./verification-source-archive-lifecycle-2026-10-19.md).

## Storico dei prompt

I nuovi record conservano lo spazio encoder completo. Indicizzazione e query usano rispettivamente i ruoli `document` e `query`; digest, dimensione e preparazione devono coincidere con lo spazio conservato. Un fallback hash registrato rimane nel proprio spazio. La ricerca usa distanze L2 sui vettori completi e rifiuta modifiche concorrenti dello storico durante la codifica.

Gli archivi legacy privi di provenienza restano conservati, ma ricerca e indicizzazione vengono rifiutate fino a ricostruzione esplicita con backup/readback/rollback verificati. Nessuna migrazione automatica o attribuzione retroattiva dell'encoder. Quel percorso per lo storico e la qualifica con encoder reali restano aperti in `HISTORY-EMBEDDING-CORRECTNESS-01`; il rebuild dei documenti non li sostituisce. [Correzione sorgente, prove isolate e limiti](./verification-history-provenance-2026-10-20.md).

## Stato della verifica

La chat espone per ogni nuovo turno con documenti il **Contesto documentale inviato per questa risposta**: anteprime e candidati restituiti dalla ricerca, testo esatto incluso, troncamenti ed esclusioni per budget, testo vuoto o documenti fuori selezione. Il dettaglio viene associato al messaggio al dispatch e conservato nel checkpoint; non ricostruisce i turni storici privi del campo. I riferimenti dei passaggi inclusi corrispondono alle schede delle fonti; l'inclusione non certifica il supporto alle affermazioni. I conteggi UTF-16 riguardano il Markdown estratto o il singolo candidato, senza sommare testo duplicato come copertura del documento. Storico precedente, parti fuori shortlist e token effettivi restano distinti. [Verifica offline, persistenza e limiti](./verification-chat-coverage-2026-10-19.md).

Le prove isolate confermano la meccanica degli spazi, dei filtri, del recupero e del ranking. La proiezione Arrow riduce il costo della scansione dei metadati nel fixture storico da 100.000 chunk. Il [lotto del 18 ottobre](./verification-retrieval-efficiency-2026-10-18.md) misura ricerca completa con encoder dichiarato, costruzione FTS, lock e I/O su 10.000 e 100.000 chunk; elimina le letture ripetute dello stesso archivio nella singola ricerca. Restano da qualificare encoder reali, distribuzioni e dimensioni più ampie, contesa e desktop installato. Il corpus di accettazione congelato e i risultati, inclusi i fallimenti, sono in [`content-acceptance.md`](./content-acceptance.md). I task aperti sono `RAG-INDEX-METADATA-EFFICIENCY-01`, `HISTORY-EMBEDDING-CORRECTNESS-01` e `QUALITY-CONTENT-LIVE-QUALIFICATION-01` nel [`tracker`](../PROJECT_STATUS.json).

Dettagli e misure datate: [`rag-sidecar-history-2026-10-13.md`](./rag-sidecar-history-2026-10-13.md) e [`verification-history-2026-10-13.md`](./verification-history-2026-10-13.md).
