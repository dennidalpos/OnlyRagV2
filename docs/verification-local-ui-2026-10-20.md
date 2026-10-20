# Riordino locale, aiuti UI e strumenti di test — 20 ottobre 2026

Implementazione del piano approvato dal proprietario. Il backlog passa da 35 task aperti a **11 autonomi**: 24 ritirati per decisione, senza dichiararli completati. ID, priorità e note storiche conservati; lista `todo_user_required` vuota. Elenco e politica operativa in [sviluppo locale e test autonomi](./local-development-policy-2026-10-20.md).

## Comportamento risultante

- Rimosso il workflow GitHub Actions, conservati suite e gate locali. Nessun commit, push o cambiamento remoto.
- Ritirati qualifiche/benchmark dei modelli, campagne live, distribuzione pubblica, recupero/smaltimento dei residui storici e nuove migrazioni legacy. Ricevute, audit, backup e dati incompatibili restano conservati.
- **84 argomenti di aiuto** nel catalogo IT/EN tipizzato, un componente `Tooltip` condiviso per viste, wizard, impostazioni, badge runtime e modali. Rimangono visibili dati, etichette, errori, progressi, richieste di approvazione e avvisi operativi. Gli aiuti accanto alle intestazioni non occupano più paragrafi permanenti.
- Eliminati dalla UI e dal preflight i risultati storici per modelli specifici e i check informativi `probes`/`qualification`. Capacità rilevate e vincoli runtime conservati.
- Tooltip su hover/focus, descrizione accessibile anche per controlli annidati, chiusura con Escape e focus invariato. Nei modali, portal nel layer interno alla radice attiva e fuori dal pannello scorrevole; il primo Escape chiude l’aiuto. Posizione aggiornata su scroll/resize/zoom.
- Smoke facoltativi con host, ruoli e opzioni salvati nell’app, usando il decoder canonico estratto in un modulo senza Electron/storage. Nessun modello predefinito scelto dal test, download o scrittura delle impostazioni personali. Workspace e destinazioni della copia puntano a directory possedute; installazione automatica di skill disabilitata nella sola copia.
- Budget durabile condiviso tra runner: 4 generazioni, 16 batch embedding e 5 minuti dalla prima apertura della sessione, con prenotazione prima del dispatch, nessun rimborso su errore e lock esclusivo. Il runner desktop passa attraverso il proxy limitato agli endpoint ammessi; richieste in serie, nessun download modello o redirect esterno.
- Entry point delle vecchie campagne fermati prima dell’esecuzione. La funzione offline di copia delle ricevute audit resta utilizzabile e testata; il caricamento delle vecchie impostazioni di campagna è disattivato.

## Verifiche e limiti

Verifiche concluse il **21 ottobre 2026**, in copia isolata con **1.206 file sorgente/documentali inizialmente corrispondenti byte per byte**. Dopo l’ultimo controllo del runner è stata ripetuta l’intera suite TypeScript sui sorgenti aggiornati. Dipendenze Node e venv di sviluppo sono riutilizzate tramite junction censite: nessuna installazione pulita indipendente è attestata.

| Controllo | Risultato e limite |
| --- | --- |
| `npm run test -- --coverage --reporter=dot` | **2.972 passati / 325 file**. Coverage statement 72.46%, branch 63.50%, funzioni 66.46%, righe 74.10%. |
| Python dev `-B -m pytest -q -rs --tb=short -p no:cacheprovider` | **666 passati / uno skip**: symlink di directory non disponibile sull’host; junction eseguite. |
| `npm run quality:python` | **15 passati, nessun caso mancante o saltato**. |
| Statico, tipi, Knip normale/produzione, cicli, documentazione | Passati; 878 file controllati e 107 handler IPC. |
| Build e smoke Main Electron | Passati, in copia isolata. Nessun installer costruito o installato. |
| `npm run test:tooltips` | **6 gruppi nativi passati**: componente impostazioni reale, badge runtime, albero accessibile, hover/focus, modali e zoom 100/150/200%. Immagini conservate e ispezionate. |
| Entry point storici ritirati | **9 rifiuti verificati** con messaggio di ritiro prima della campagna. |
| Conservazione | Insieme dei 66 file `userdata_dev` e tutti i **68 hash protetti**, incluse impostazioni e log dev esterni, invariati. |

Nessuna inferenza reale, nuova installazione, migrazione personale, commit o push eseguiti. I test sul runner usano impostazioni sintetiche, server locali controllati e clock controllato; non valutano o classificano modelli. Gli 11 task locali restano aperti: questo intervento ne rende autonomi i criteri e prepara gli strumenti, senza dichiararli completati.

Sono conservati i tentativi intermedi: asserzioni adeguate ai testi ora disponibili nei tooltip, disattivazione inizialmente troppo ampia di un helper offline e problemi del solo caricamento/cattura immagini della fixture Electron. Nessun criterio funzionale è stato rimosso per ottenere il verde; le asserzioni UI ora aprono e verificano gli aiuti tramite focus.

La prima Sync SecondBrain ha segnalato un conflitto nel blocco gestito di AGENTS: il confronto ha identificato soltanto LF/CRLF. Ripristinati i byte esatti del blocco da HEAD, conservando le nuove direttive esterne; Sync successiva riuscita con zero segnalazioni. Nessuna modifica al generatore o alle direttive globali approvate.

## Evidenze

Root durevole: `C:/Users/Utente/OnlyRag-Live/local-ui-20261020-68df2155`. Contiene tracker precedente, 24 record ritirati, manifest degli hash dei 68 file protetti, copia sorgenti, log, ricevute e immagini della prova Electron. Le junction `verification-source/node_modules` e `.venv` puntano rispettivamente al checkout e al venv di sviluppo esterno: non trattare la copia come un ambiente indipendente dalle dipendenze e non attraversare i link durante eventuale manutenzione.

I file ignorati preesistenti nel checkout sono preservati. La conservazione di artefatti ufficiali e prove fallite è distinta dalla rimozione di temporanei del task; il ritiro dei task storici non autorizza lo smaltimento delle relative prove.
