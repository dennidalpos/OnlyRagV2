# Passaggio di sessione: sviluppo locale e aiuti UI — 21 ottobre 2026

Il proprietario ha chiesto di salvare il lavoro e il tracker, fare commit sul branch principale e push. Destinazione verificata: repository pubblico `dennidalpos/OnlyRagV2`, remoto `origin`, branch predefinito `master`, base `683fa1dae0a4f0b5f1856707fb29cea869395276`; prima della consegna locale e remoto sono allineati. SHA finale e verifica del push sono registrati nel contesto SecondBrain e nella ricevuta esterna indicata sotto.

## Lavoro salvato

- Backlog ridotto da 35 a **11 task aperti autonomi**, tutti P2 con ID conservati; nessun task richiede più decisioni del proprietario. I 24 task rimossi sono **ritirati per decisione**, senza dichiararli completati. Elenco, confini e criteri in [politica locale](./local-development-policy-2026-10-20.md).
- Workflow GitHub Actions rimosso, suite e comandi locali conservati. Qualifiche/campagne dei modelli, distribuzione e nuove migrazioni legacy ritirate per questa fase; prove, ricevute, backup e dati incompatibili conservati.
- 84 aiuti centralizzati nel catalogo IT/EN e nel componente Tooltip, con focus/hover, Escape, descrizioni accessibili, modali, bordi e zoom. Dati, errori, progressi e decisioni restano visibili. Rimossi badge e check informativi di qualifiche storiche; capacità effettive e vincoli runtime conservati.
- Smoke funzionali facoltativi preparati per le sole assegnazioni/opzioni salvate manualmente nell'app. Nessun fallback, download o modifica delle impostazioni personali. Profili, workspace e output isolati; richieste seriali con budget condiviso durabile di **4 generazioni, 16 batch embedding e 5 minuti**, inclusi errori e riprove. Riutilizzare la stessa directory assoluta di sessione tra runner e riavvii. Le vecchie campagne rifiutano l'avvio.

## Verifiche della consegna

Il [resoconto completo](./verification-local-ui-2026-10-20.md) documenta le prove concluse il 21 ottobre: **2.972 test TypeScript / 325 file**, **666 Python passati e uno skip dell'host** per symlink directory, **15 test Python critici senza skip**. Passano statico, tipi, Knip, cicli, documentazione, build, smoke Main Electron e sei gruppi nativi sui tooltip. Le prove sono in copia isolata; Node e venv condivisi tramite junction censite, nessuna installazione pulita indipendente attestata.

Prima degli aggiornamenti documentali per la pubblicazione è stata ricontrollata la corrispondenza SHA-256 di tutti i **1.206 file** della consegna verificata. Runtime, test e configurazioni restano identici a quelli delle suite complete: per questo seguito si rieseguono documentazione, formato/JSON, diff e conservazione dei dati. Tutti i **68 hash protetti** e l'insieme dei **66 file userdata** risultano invariati. Nessuna inferenza reale o costruzione/installazione di installer in questa consegna.

Evidenze conservate fuori dal checkout:

- Implementazione e suite: `C:/Users/Utente/OnlyRag-Live/local-ui-20261020-68df2155`.
- Pubblicazione e verifica Git: `C:/Users/Utente/OnlyRag-Live/local-ui-publication-20261021-a94f0c1b`, con `prepublication-correspondence.json`, ricevute dei controlli e `publication-receipt.json` finale.
- Tracker operativo: [PROJECT_STATUS.json](../PROJECT_STATUS.json); architettura e decisioni nel dossier `D:/GITHUB/SecondBrain/02-areas/products/OnlyRagV2`.

## Ripresa

Gli 11 task rimangono aperti: questo intervento ha riordinato criteri e strumenti, senza svolgere i problemi funzionali residui. Usare `todo_autonomous` nel tracker come elenco corrente; i conteggi e gli obblighi nelle note precedenti sono storici. Per priorità uguali si può riprendere dal primo task, `RAG-INDEX-METADATA-EFFICIENCY-01`, oppure scegliere un altro ambito locale dal tracker.

I test ordinari usano risposte controllate, server locali e dati sintetici. Gli smoke con modelli reali sono facoltativi e richiedono le assegnazioni correnti dell'app; configurazioni mancanti o endpoint non supportati interrompono la prova senza sostituzioni. Nessuna nuova campagna, CI, migrazione personale o cancellazione di evidenze è necessaria per riprendere. L'autorizzazione al push riguarda i sorgenti di questa consegna; non aggiunge una release di installer.
