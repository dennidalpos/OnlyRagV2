# Passaggio di sessione: correzioni locali — 20 ottobre 2026

Richiesta esplicita: salvare il lavoro, aggiornare il tracker, commit sul principale e push per cambio sessione. Remoto verificato pubblico [dennidalpos/OnlyRagV2](https://github.com/dennidalpos/OnlyRagV2), default `master`, base `e95e915922c5079b7fe1004e9ec5ffd58610abdf`; fetch e readback iniziali allineati 0/0. Questa consegna è identificata dal commit che contiene il documento. SHA risultante, conferma push e stato della CI vengono registrati nel dossier SecondBrain, senza attribuire esiti futuri al commit stesso.

## Stato salvato

Il [resoconto locale](./verification-tracker-local-2026-10-20.md) conclude e rimuove soltanto tre ID: `TRANSLATION-OUTPUT-PUBLICATION-01`, `TRANSLATION-DOCX-CONTENT-COVERAGE-01`, `DEPENDENCY-MONACO-VENDORED-SANITIZER-01`. Implementati staging/validazione/pubblicazione esclusiva PDF e DOCX, visita dei contenitori DOCX supportati con rifiuto preventivo degli altri, DOMPurify 3.4.17 nel grafo Monaco e gate Electron nativo in CI. Corrette le fixture deadline/retention e l'isolamento dello storage Node; runtime worker e retention invariati. Quattro benchmark RAG locali 10k/100k chunk, dimensioni 768/1024 e letture durante aggiornamenti rispettano il p95 approvato di 5 secondi. Non sono misure dell'encoder reale o dell'ingestione completa.

[PROJECT_STATUS.json](../PROJECT_STATUS.json): **34 attività aperte, 15 autonome / 19 owner-required, 4 P1 / 27 P2 / 3 P3**. Schema, ordine, priorità, note e criteri precedenti preservati. Nuovo P2 `DEV-AUDIT-HISTORY-RECOVERY-01`, senza duplicare i residui di conservazione. Le precedenti note senza commit/push descrivono le fasi anteriori a questa autorizzazione.

## Ripresa

1. Leggere AGENTS, tracker, dossier attivo e stato Git; rileggere la CI dell'esatto SHA contenente questo documento. `CI-DEPENDENCY-SCAN-WORKER-DEADLINE-01` e `CI-CAPABILITY-AUDIT-RETENTION-TIMEOUT-01` restano aperti: test locali corretti e coperti, ma fase esatta dei vecchi timeout non dimostrata. Non confondere il verde remoto della base e95e915 con questa revisione.
2. Conservare il nuovo incidente audit: due suite nel checkout principale hanno aggiunto 42 eventi (23+19) a `userdata_dev/logs/capability_policy_audit.json`, soggetto al limite di 1.000 record. Altri 65 file iniziali invariati. SHA iniziale `6AD31E56F44A680310A0166756FFA092E8957139EDFC40B0506AF913549EBC03`; attuale `3DDAE7EFCC4151109F13DCFA4D1E68625FEF5A082F784B3D9E373502C57F474F`. Entrambe le versioni successive sono copiate/verificate. Il proprietario dichiara nessun backup: non equivale ad accettare la perdita o chiudere il task. Servono byte iniziali verificati oppure una disposizione esplicita del proprietario; nessuna ricostruzione ipotetica o cancellazione. Ultima suite isolata: tutti i 66 file attuali del profilo principale e audit sentinella invariati; questo non recupera l'eventuale storico espulso.
3. Per ulteriori suite complete usare una copia isolata dei sorgenti e confrontare gli hash del profilo prima/dopo. Il setup Node assegna storage temporaneo per file, incluse dipendenze singleton; i test del resolver originale usano cwd temporaneo. La copia finale trattenuta ha una junction `node_modules` verso il checkout: evitare operazioni ricorsive implicite sul link. Il checkout non ha `.venv`; il Python dev esterno preesistente è indicato nelle ricevute, senza modificarne dipendenze. Il wrapper npm Python non è stato dichiarato eseguito.
4. Perimetro corrente: correzioni/verifiche locali più la presente pubblicazione sorgenti. Nessuna nuova autorizzazione a chiamate modello, profili installati, migrazioni personali o smaltimento prove. Budget ledger di otto chiamate esaurito e fallimenti semantici conservati. Restano aperte qualifiche installate, encoder/ingestione reali, compatibilità legacy e power-loss. Non richiedere nuovamente la scelta del carico RAG già approvata.
5. `RETAINED-RESIDUE-DISPOSAL-01` conserva candidati, profili, root indisponibile della sanificazione e rifiuti automatici precedenti. La pulizia degli output/cache del lotto locale è stata rifiutata prima dell'esecuzione: `blocked by policy`, senza altri dettagli. Originali ignorati e nuove fixture conservati; nessun metodo alternativo di cancellazione tentato. Non estendere il commit ai dati ignorati o alle prove esterne.

## Gate della consegna

Verifiche complete già eseguite sugli stessi sorgenti runtime/test/config prima della richiesta di commit; dopo sono cambiati solo documentazione e tracker. La corrispondenza SHA256 viene ricontrollata prima del commit, evitando ulteriori esecuzioni sul profilo principale.

| Controllo | Esito e limite |
| --- | --- |
| npm run test con coverage, copia isolata | 2.953 passati / 323 file, 214,04 s; statement 72,29%, branch 63,34%, funzioni 66,21%, righe 73,92% |
| Python dev 3.13.15, -B -m pytest | 666 passati, un symlink di directory non disponibile saltato, 160,87 s; junction native eseguite |
| Gate Python critico, stesso script con interprete esterno | 15 passati, nessun caso mancante/saltato; wrapper npm richiede .venv nella root e non è eseguito |
| Build e probe nativo Monaco | Passati con npm ci dal lock; versione DOMPurify e chiamanti reali verificati |
| Statico, tipi, Knip normale/produzione, cicli | Passati; statico 866 file/107 handler IPC; setup Node controllato separatamente con ESNext/bundler |
| Documentazione, JSON, diff e indice Git | Ricontrollati sulla consegna; esiti finali nel dossier e ricevute esterne |
| Conservazione ultima suite isolata | 1.188 file sorgente byte-identici prima del test, 66 file attuali userdata e sentinella invariati; non ripristina la baseline audit |

Nessun esito locale certifica CI remota, semantica dei modelli, desktop installato, diritti di distribuzione o perdita di alimentazione.

## Evidenze

Lotto locale preservato in `C:/Users/Utente/OnlyRag-Live/tracker-local-fixes-20261020-1de2acbf`: sorgenti ZIP/manifest, log, ricevute profilo, entrambe le copie audit e benchmark RAG/Monaco. Mappa di trasferimento con readback di 2.136 file; copia non distruttiva di 77 output/cache in `generated/`. Non riscrivere le evidenze storiche. Nuovo backup della pubblicazione: `C:/Users/Utente/OnlyRag-Live/local-fixes-publication-20261020-2b9cc358`.

Dossier: `D:/GITHUB/SecondBrain/02-areas/products/OnlyRagV2/context.md` e `memory.md`. Dopo il push leggere il nuovo riepilogo di pubblicazione, preservando le note storiche e distinguendo lo stato della CI da quello locale.
