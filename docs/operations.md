# Setup, test e release

## Prerequisiti

- Windows 10/11 64-bit.
- Node `>=24.19.0 <25` e npm `>=11 <12` (`.nvmrc`, `package.json`).
- Python `3.13.15` (`.python-version`).
- Ollama installato, con endpoint predefinito `http://127.0.0.1:11434`.
- In modalità remota un endpoint offline mostra solo Riprova server e Configura server; installazione e avvio locali restano disponibili esclusivamente in modalità locale.

Setup: `npm run setup:dev`.

Electron 43 non scarica il runtime durante `npm ci`: il setup e la CI eseguono `node node_modules/electron/install.js`, perché smoke test ed E2E avviano direttamente `node_modules/electron/dist/electron.exe`. La CI (`.github/workflows/ci.yml`, `windows-latest`) esegue `quality:static`, `scripts/lint_format.ps1 -Fast -SkipTests` (smoke del bundle incluso), `test:coverage` e `scripts/test_sidecar_health.ps1 -Fast` con una `.venv` creata da `sidecar/requirements-dev.txt`.

## Comandi principali

| Scopo | Comando |
| --- | --- |
| Sviluppo | `npm run dev` |
| Build | `npm run build` |
| Test rapidi | `npm run test:fast` |
| Test Sidecar | `npm run test:sidecar` |
| Tipi | `npm run typecheck` |
| Qualità statica | `npm run quality:static` |
| Documentazione | `npm run docs:check` |
| Cicli | `npm run audit:cycles` |
| Dead code | `npm run audit:deadcode` |
| Audit composito | `npm run audit:all` |
| Smoke bundle | `npm run test:smoke` |
| Rete avvio Main e Renderer | `npm run test:e2e:cold-start` |
| Bootstrap impostazioni | `npm run test:e2e:settings-bootstrap` |
| Bundle e interfaccia | `npm run test:e2e:bundle-ux` |
| OpenAPI | `npm run generate:openapi` |
| Asset | `npm run assets:check`, `npm run assets:generate` |
| Installer | `npm run package:win` |

Target Vitest: `npx vitest run <path>`. Con output silenzioso e un percorso usare `npm run test:fast -- --silent=true <path>`: `--silent <path>` viene interpretato come valore dell'opzione, non come filtro dei test.

## Script di supporto

- `setup_dev_environment.ps1`: Node, Python, virtualenv e dipendenze.
- `audit_codebase.ps1`: cicli con dpdm, dead code con Knip, sintassi Python con `compileall` se la `.venv` esiste e grafo con skott. `-Mode Cycles`, `DeadCode` o `Graph` seleziona il controllo; `-WebUI` apre il grafo interattivo. Non esegue typecheck o test e non equivale al doppio passaggio Knip di `audit:deadcode`.
- `lint_format.ps1`: diff/documentazione/JSON, typecheck, sintassi Python, Vitest e smoke del bundle; la CI usa `-Fast -SkipTests` perché esegue Vitest con coverage nello step successivo.
- `build_package.ps1`: Sidecar PyInstaller, bundle e installer NSIS.
- `test_bundle_smoke.ps1`: avvio del bundle con una `userData` temporanea (rimossa a fine esecuzione) e marker smoke cercato nel suo `logs/app.log`.
- `clean_repo.ps1` e `clean_workspace.ps1`: pulizie separate con target espliciti.

I comandi distruttivi (`clean:full`) richiedono attenzione: possono rimuovere dati utente locali.

## Disinstallazione e dati

Le scritture Main condivise di impostazioni, registro progetti, sessioni, stato/tracker agente e artefatti usano staging e rename con retry Windows. Un lock persistente produce un errore, senza fallback di copia sul file precedente; ritentare esplicitamente dopo aver risolto l'errore. I test di sostituzione rifiutata non certificano perdita di alimentazione o arresto forzato. [Verifica](./verification.md#atomic-state-writer--2026-10-06).

Le nuove ingestion conservano originali e manifest di estrazione in `<userData>/data/source-documents/<doc_id>`; i vecchi documenti non vengono migrati. Limiti: 512 MiB per originale, 10 milioni di code point estratti e 10.000 pagine; il superamento impedisce l'indicizzazione. Copie di ingestion fallite/rifiutate/cancellate e documenti eliminati restano conservate, ma non navigabili senza record e revisioni validi. Backup/export e reclamazione esplicita sono tracciati in `SOURCE-ARCHIVE-LIFECYCLE-01`; non eliminare queste cartelle come semplici file temporanei. Dettagli: [provenienza](./rag-sidecar.md#claimsource-provenance--2026-10-02).

Il disinstallatore mostra «Delete personal data too / Elimina anche i dati personali», disattivato inizialmente. Senza selezione, impostazioni, cronologia e archivio documenti restano disponibili. Una rimozione silenziosa conserva i dati; l'opzione esistente `--delete-app-data` ne richiede esplicitamente la rimozione. Gli aggiornamenti conservano i dati e rifiutano la combinazione `--updated --delete-app-data` con codice 2.

`powershell -ExecutionPolicy Bypass -File scripts/test_uninstall_policy.ps1` compila pagina e macro NSIS in una fixture temporanea con percorsi rediretti. Verifica conservazione, stato di selezione simulato, consenso silenzioso e aggiornamenti, senza usare AppData reale. Richiede il compilatore NSIS nella cache di electron-builder; non sostituisce la verifica visiva della pagina.
