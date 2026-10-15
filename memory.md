# Architecture Patterns

- Electron Main owns desktop IPC and process lifecycle; the React renderer uses typed IPC contracts, while the Python Sidecar owns ingestion and retrieval.
- Persistent document and agent state requires explicit ownership, backup/readback and refusal on invalid existing data. `docs/architecture.md`, `docs/rag-sidecar.md` and `docs/agent-runtime.md` describe the boundaries.

# Decisions & Trade-offs

- Repository skill files are workspace-local development guidance, not default skills for unrelated user projects. Keep `skills/*/SKILL.md` scoped by precise `description`, `triggers` and `tags`; the runtime matcher uses these fields and defaults to three active skills per task.
- Greenfield cleanup may remove obsolete code, but retained live-campaign evidence, original documents, personal stores and migration backups are protected until their separate acceptance or disposal decision.
- The tracker contains only open work. Dated verification and audit documents retain historical results.
- La guida per l'utente finale è `docs/guida-utente.md`, con SVG statici modificabili in `docs/assets/flussi-utente/` e percorsi testuali equivalenti. Conservare collegamenti relativi e risorse locali per consultazione offline senza dipendenze di rendering dei diagrammi.

# Lessons Learned & Gotchas

- The generic Codex skill validator rejects OnlyRag's supported `triggers` and `tags` frontmatter. Validate repository skills against `skillRepository.ts` and the runtime matcher instead of removing those fields.
- Il log audit Coding Agent usa un solo interruttore per payload completi; redige credenziali ma conserva percorsi ed errori utili. Il log operativo generale resta più restrittivo.
- I delta dei prompt nell'audit dipendono da una baseline nella stessa generazione conservata: azzerare l'ancora a ogni rotazione, leggere solo le generazioni presenti in ordine e attribuire le voci tramite identità strutturata, non tramite testo libero nel payload.
- Nel Coding Agent, `sourceLines` dell'inventario usa le righe originali non vuote della richiesta; un riferimento invalido ammette una sola riprova con errore esplicito, mai una correzione automatica dei numeri.
- Per installer esterni senza digest o firma verificabile prima dell'esecuzione, aprire la pagina ufficiale costante nel browser; distinguere apertura, installazione e disponibilità del servizio.
- A passing build or deterministic fixture does not certify content quality, an installed desktop, real-model behavior or power-loss durability. Preserve these distinctions in acceptance claims.
- Session deletion preparation has no destructive phase until its verified manifest directory is published. On restart, promote only complete staged records; retain and expose incomplete staging for export while letting unrelated sessions proceed.
- Coding history uses a Main-owned per-session recovery journal before debounced canonical writes. Remove it only after the identical normalized revision is acknowledged; an older save advances its base digest. Retry refuses a divergent canonical revision and leaves Export available.
- Se storico e journal rifiutano entrambi la scrittura, `sessions:export-snapshot` esporta la revisione normalizzata ancora in memoria senza consultare gli archivi interni. Nome casuale, creazione esclusiva, flush e readback precedono il successo; una copia esterna non riconosce il salvataggio canonico e non sblocca la chiusura. La prova isolata usa hook/banner di produzione con Main e Preload reali (`scripts/e2e/codingHistoryMemoryExport.mjs`).
- Diagnostic scripts should resolve transitive packages through their declaring direct dependency; direct imports of a transitive package fail `knip` and depend on lockfile hoisting.
- Per l'audit Python della build CPU, confrontare il lock generato con `component-manifest.json` e interrogare il lock completo: i soli `.dist-info` conservati da PyInstaller non rappresentano l'intero insieme delle dipendenze. `pip freeze` omette `pip`, che può comparire nel lock.
- Per documentare le scelte dell'utente, verificare visibilità dei controlli e richieste effettive nei componenti/hook: una voce in `src/i18n/locales/it.ts` non prova che la funzione sia attiva. Il percorso di importazione esaminato passa `normalizeWithLlm: false`; `Pianifica` non compare in modalità Ask.
- Gli ancoraggi Markdown del validatore eliminano la punteggiatura prima di convertire gli spazi in trattini: un titolo con ` · ` produce due trattini. Nei titoli numerati della guida usare numero e spazio, lasciando il punto mediano alle etichette dei diagrammi.
- Un aggiornamento fuori dall'intervallo di un advisory può eliminarlo dall'audit senza provare la correzione del comportamento segnalato. Per `http-cache-semantics` 4.3.0 distinguere l'esito del registro dalla contestazione del manutentore e dalla verifica separata della cache HTTP Got disabilitata (`docs/libraries.md`).
