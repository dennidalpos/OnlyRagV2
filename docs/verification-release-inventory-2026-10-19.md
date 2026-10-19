# Inventario delle evidenze release — 19 ottobre 2026

`RELEASE-CANDIDATE-EVIDENCE-EXTRACTION-01` concluso. Inventariate tutte le tre directory sotto `release/`, senza modificare artefatti, avviare installer, installare l'app o eseguire modelli. Il [report JSON](./verification-release-inventory-2026-10-19.json) contiene percorsi, SHA-256, disponibilità delle ricevute e limiti.

| Candidato | Rilettura | Esito |
| --- | --- | --- |
| `cpu-20261014-205040-fae7d51b` | Installer e ZIP, 3.554 record payload / 1.238.549.680 byte, 1.013 file progetto nello ZIP, metadati e source-delivery | Hash/dimensioni coincidenti; ZIP con 33.222 membri, 72 archivi dipendenze e 32.134 file sorgente Node |
| `cpu-20261018-220641-87a891b9` | Riutilizzata la [qualifica precedente](./verification-current-source-2026-10-19.md), senza ripetere estrazione o probe frozen; riletti i 29 file delle ricevute | 29/29 ricevute presenti e identiche SHA-256; fonte, hash e percorsi nel JSON |
| `cpu-20261019-092848-b9054e25` | Installer e ZIP, 3.545 record payload / 1.238.460.914 byte, 1.113 file progetto nello ZIP, metadati e source-delivery | Hash/dimensioni coincidenti; ZIP con 33.432 membri, 72 archivi dipendenze e 32.244 file sorgente Node |

Le nuove riletture calcolano gli hash in streaming e confrontano i membri `OnlyRag/` con `project-source-manifest.json`, senza estrarli sul filesystem. Lo script rifiuta percorsi assoluti, traversal, escape da root e duplicati payload/ZIP. Si verificano i record dei manifest, senza classificare gli altri file conservati.

Il confronto dei record archiviati nelle directory applicative con il checkout trova 59 differenze nel candidato del 14 e 12 in quello del 19. Questa selezione include record Python/test presenti nel manifest e non è un inventario puro del runtime o una corrispondenza dei binari con un commit. Comprende gli interventi nativi locali. Nessun candidato viene riclassificato come build dei sorgenti correnti.

## Residui preservati

La rilettura dei candidati del 14 e del 19 **non dimostra un'estrazione indipendente dei loro installer**, codice frozen/ASAR, flussi reali o desktop installato: tali qualifiche non sono state eseguite qui e restano nel task distribuzione. La prova precedente del 18 mantiene esiti e limiti propri. Non si inventano ricevute mancanti.

Tutti i manifest mantengono `publicDistributionQualified: false` e i residui su sorgenti nativi/transitivi, notice, font/modelli, diritti e consegna equivalente. Restano nei task esistenti di distribuzione, diritti e consegna pubblica. I record verificati coincidono, tutte le ricevute riutilizzate sono disponibili e il report distingue le qualifiche non eseguite.

Script monouso di lettura, log e backup: `%TEMP%/onlyrag-next-tasks-f68a963a1bb3421cb23a9340bc21cc6a`. Nessuna nuova build o estrazione installer per questo inventario; candidati e campagne fallite preesistenti conservati.
