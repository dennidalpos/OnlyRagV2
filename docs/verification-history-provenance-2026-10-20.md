# Provenienza degli embedding dello storico — 20 ottobre 2026

Corretto il difetto sorgente di `HISTORY-EMBEDDING-CORRECTNESS-01`: i nuovi record conservano modello, digest, dimensione, versione della policy, normalizzazione, preparazione e identificatore dello spazio. Il task rimane aperto per qualifica con encoder reali e ricostruzione esplicita dello storico preesistente. Nessun archivio personale è stato aperto o migrato.

## Comportamento qualificato offline

- L'indicizzazione usa il batch versionato con ruolo `document`; la ricerca usa il modello e lo spazio conservati, con ruolo `query`. I vettori sono finiti, non nulli, della dimensione dichiarata e normalizzati. I wrapper che restituivano soltanto vettori, privi di chiamanti applicativi dopo la correzione, sono rimossi.
- Lo storico usa un solo spazio verificato. Digest, preparazione, dimensione o modello incompatibili vengono rifiutati prima della sostituzione di un record. Uno spazio hash già registrato rimane hash anche dopo riapertura: non passa implicitamente a un modello disponibile successivamente.
- Tabelle legacy senza provenienza, metadati alterati, spazi misti e dimensioni incompatibili vengono rifiutati conservando versione e record originali. Non vengono etichettati retroattivamente con l'encoder corrente. La cancellazione esplicita delle sessioni mantiene il protocollo e le protezioni esistenti.
- La codifica non mantiene il lock del database. Prima della lettura finale o dell'upsert si verifica nuovamente la versione dello storico; una modifica concorrente produce `DatabaseConflictError`/HTTP 409. I fence delle sessioni eliminate restano attivi.
- La ricerca imposta esplicitamente L2 e bypassa gli indici vettoriali per ottenere distanze sui vettori completi. Quattro geometrie native verificano il punteggio `max(0, 1 - distanza_quadratica / 2)`. Una distanza assente, negativa o non finita non diventa un risultato valido.

Lo storico legacy continua a essere conservato, ma ricerca e nuove indicizzazioni sulla sua tabella vengono rifiutate fino a una ricostruzione autorizzata con backup, readback e rollback verificati. La ricostruzione generale degli embedding dei documenti non ricostruisce lo storico: il relativo percorso resta da implementare e qualificare. Il rifiuto della provenienza passa attraverso l'errore REST interno esistente; nessuna risposta vuota nasconde quel problema.

## Evidenze

Ricevuta con hash: [`verification-history-provenance-2026-10-20.json`](./verification-history-provenance-2026-10-20.json). Log, sonde e copie iniziali in `C:/Users/Utente/AppData/Local/Temp/onlyrag-loopback-0e544c2b6c054c138ca52405c2a31b45`.

| Controllo | Esito |
| --- | --- |
| `pytest` mirato: provenienza, errori storico, recupero documenti, embedding | 92 passati nella configurazione finale |
| `.venv/Scripts/python.exe -B -m pytest -q -rs --tb=short -p no:cacheprovider` | 621 passati, un symlink di directory non disponibile saltato; 159,20 s. Raccolta precedente all'aggiunta dell'ultimo test di riapertura, poi passato nei mirati finali. |
| `npx vitest run --reporter=dot` | 2.940 passati / 322 file, 186,75 s; sorgenti TypeScript invariati in questo lotto |
| `pwsh -NoProfile -File scripts/lint_format.ps1 -Fast -SkipTests -Format` | Passato: formattazione, JSON, typecheck, compilazione Python, 15 critici, 31 WhatIf e 17 cleanup reali isolati |
| `npm run quality:static` | Passato: 858 file, 105 handler IPC |

La prima esecuzione seriale ha segnalato una riga vuota finale nel wrapper rimosso; normalizzata prima del gate riuscito. Nessuna modifica comportamentale successiva alla suite Python completa. Il nuovo test finale verifica il percorso reale della policy con trasporto HTTP simulato indisponibile e LanceDB riaperto, senza chiamate a modelli reali.

LanceDB installato: **0.37.1**. Riferimenti primari: [implementazione versionata del query builder](https://github.com/lancedb/lancedb/blob/v0.37.1/python/python/lancedb/query.py), [guida ufficiale alle metriche e alle distanze esatte](https://docs.lancedb.com/search/vector-search). Il comportamento della versione locale è verificato dalle prove native; la documentazione corrente non viene usata come prova di altre versioni.

## Residui e perimetro

Encoder reali, qualità semantica e procedura autorizzata di ricostruzione dello storico non sono qualificati. `HISTORY-EMBEDDING-CORRECTNESS-01` resta nel tracker, aggiornato con la distinzione fra difetto sorgente corretto e accettazione residua. Nessun commit, push, installer, nuova inferenza reale, migrazione personale o smaltimento delle evidenze precedenti.
