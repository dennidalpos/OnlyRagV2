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

Public distribution requires the reviewed [license policy and artifact notices](./distribution-licenses.md), as well as current-source bundle qualification. The existing MIT declaration and an installer build alone do not establish these gates.

## Offline embedding store maintenance — 2026-10-10

The approved source CLI operates on an explicitly declared application userData root. Close the application first, keep retained evidence and provide a separately authorized synthetic root for qualification. These are usage examples, not authorization to migrate a personal profile:

```powershell
.venv\Scripts\python.exe scripts/rebuild_embeddings.py preview --root "D:\Isolated\OnlyRag-Rebuild"
.venv\Scripts\python.exe scripts/rebuild_embeddings.py prepare --root "D:\Isolated\OnlyRag-Rebuild" --model "nomic-embed-text"
.venv\Scripts\python.exe scripts/rebuild_embeddings.py activate --root "D:\Isolated\OnlyRag-Rebuild" --rebuild-id "<verified-prepare-id>"
.venv\Scripts\python.exe scripts/rebuild_embeddings.py rollback --root "D:\Isolated\OnlyRag-Rebuild" --rebuild-id "<verified-prepare-id>"
```

Use the exact ID returned by a successful `prepare`; no discovery, latest-job selection, default root or automatic activation exists. `prepare` needs an explicitly selected installed native encoder at the configured local `OLLAMA_BASE_URL`. Catalog/dimension/digest, task preparation and vector gates retain the existing encoder request limits. No fallback vectors are accepted. `preview`, `activate` and `rollback` make no encoder request; `preview` can recover a pending document journal before reading.

Occupied lease, live matching old Sidecar marker, bad journal/pointer, linked/out-of-root artifacts, changed source/backup/archives/candidate, invalid native vectors or document/chunk coverage refuse with a nonzero exit. Invalid arguments exit 2; refused operations exit 1; only verified success returns JSON and exit 0. Preserve artifacts on refusal. The CLI never stops processes, cleans jobs or migrates personal data automatically. Recovery and table inventories include every table page.

Successful preparation retains a complete store backup, retained originals, candidate and immutable verified manifest under `data/rebuilds/<id>`. Only activation/rollback replace `data/active-store.json`; Sidecar resolves it on next startup. A present invalid pointer blocks startup without legacy fallback. Rollback verifies exact ownership and unchanged prior backup/source, retains later candidate writes and does not merge them. Historical document status/fallback fields stay unchanged; chunk provenance describes the rebuilt vectors. If current chunking changes recorded counts, request a separately reviewed metadata migration rather than editing the manifest/documents.

The source CLI is verified with real isolated LanceDB, declared loopback embeddings, restart/readback and owned-process interruptions. The frozen packaged runtime, personal migration, large-store cost and power-loss durability remain unqualified. Closing the application is also required for old runtimes which cannot honor the new lease. See [protocol and evidence](./rag-sidecar.md#offline-embedding-store-rebuild--2026-10-10) and [verification](./verification.md#offline-embedding-store-rebuild--2026-10-10).

Target Vitest: `npx vitest run <path>`. Con output silenzioso e un percorso usare `npm run test:fast -- --silent=true <path>`: `--silent <path>` viene interpretato come valore dell'opzione, non come filtro dei test.

## Script di supporto

- `setup_dev_environment.ps1`: Node, Python, virtualenv e dipendenze.
- `audit_codebase.ps1`: cicli con dpdm, dead code con Knip, sintassi Python con `compileall` se la `.venv` esiste e grafo con skott. `-Mode Cycles`, `DeadCode` o `Graph` seleziona il controllo; `-WebUI` apre il grafo interattivo. Non esegue typecheck o test e non equivale al doppio passaggio Knip di `audit:deadcode`.
- `lint_format.ps1`: diff/documentazione/JSON, typecheck, sintassi Python, Vitest e smoke del bundle; la CI usa `-Fast -SkipTests` perché esegue Vitest con coverage nello step successivo.
- `build_package.ps1`: isolated CPU Sidecar, fresh bundle/NSIS, installed notices and matching source candidate. Use `npm run package:win`; each run writes a new `release/cpu-*` child. `-SkipSidecar` refuses before output creation; `-RequireSignature` still requires a valid signature. The default permits an explicitly reported unsigned candidate. See [CPU release evidence](./distribution-cpu-release.md).
- `node scripts/e2e/buildDownloadCachePolicy.mjs`: installed build downloader/artifact cache checks against a synthetic loopback server; Windows CI runs the same guard after Node setup. It does not build an installer or download public artifacts.
- `node scripts/e2e/dependencyScannerIsolation.mjs` after `npm run build`: native worker/parser refusal checks and a synthetic Electron ASAR with the installed depcheck dependency closure. It uses temporary synthetic workspaces, not live models or personal profiles.
- `test_bundle_smoke.ps1`: avvio del bundle con una `userData` temporanea (rimossa a fine esecuzione) e marker smoke cercato nel suo `logs/app.log`.
- `clean_repo.ps1` e `clean_workspace.ps1`: pulizie separate con target espliciti e preflight condiviso in `cleanup_policy.ps1`.

`Repo`, `TestResidues` and `Full` now require `-DisposablePaths` with reviewed literal absolute paths. The scripts no longer discover disposable work by prefix or file extension. `Full` excludes app profiles; only the separate explicit `UserData` mode retains that intent and still refuses protected recovery/evidence. `Logs` and `InstallerCache` retain separately named scopes; backups/log evidence and protected metadata can make those scopes refuse. `StopAppProcesses` and combined `CleanLogs` refuse before mutation; close the application deliberately and use separate modes. Review disposal ownership and retention before invoking any removal. [Safety verification and remaining limits](./verification.md#cleanup-safety-policy--2026-10-10).

Example from PowerShell, after reviewing the exact generated output: `./scripts/clean_repo.ps1 -DisposablePaths @((Join-Path (Get-Location).Path 'dist-electron')) -WhatIf`. The preview performs all eligibility checks; removing `-WhatIf` is a deliberate disposal action. No real-data cleanup was performed in the repair.

### Cleanup safety policy — 2026-10-10

The user approved this concrete CLI/policy change, now implemented. Broad extension/prefix-based deletion is removed; an explicit `-DisposablePaths` list is required for repository outputs and test residues. `Repo`, `TestResidues` and `Full` fail before mutation without that list; `-WhatIf` performs the same eligibility checks. A supplied list expresses the operator's reviewed disposal decision, not automatic test ownership. No marker is retroactively written and no retained campaign is automatically classified as disposable.

Preflight every selected literal absolute path before any removal or delegated script: require containment in the applicable repository/temp/Desktop root, reject root/ancestor targets, reparse points in ancestors/descendants, tracked files/descendants and protected state/evidence. Preserve `.onlyrag`, `userdata_dev`, app profiles, models, configured/default OnlyRag-Live roots, `Desktop/test_app`, recovery/checkpoint/source-archive paths and the explicitly retained `build/tabular-probes`. Parent selection must not bypass these protections. Remove only the preflighted list, using native literal-path PowerShell and existing ShouldProcess; recheck immediately before removal. Never scan the whole repository for untracked backup/log files by extension.

`Full` stops including user data implicitly. Explicit `UserData`, `Logs` and `InstallerCache` remain separately scoped and reject reparse/tracked/protected evidence rather than letting delegation evade safety checks. `StopAppProcesses` refuses before mutation because its name-only lookup cannot identify an owned process; close the application deliberately instead. `CleanLogs` now requires the separate Logs mode. An owned-process cleanup protocol is a future separately reviewed boundary.

Acceptance uses isolated synthetic repositories/profiles and `-WhatIf`: preserved state/retained evidence, tracked descendants, sibling/root traversal, actual junction targets/ancestors/descendants, backups, missing/mixed/overlapping lists, Full delegation, process-stop refusal and reviewable disposable candidates. No real cleanup or process termination is included in this repair. Explicit provenance review/disposal of old retained work remains in `RETAINED-RESIDUE-DISPOSAL-01`.

## Disinstallazione e dati

Le scritture Main condivise di impostazioni, registro progetti, sessioni, stato/tracker agente e artefatti usano staging e rename con retry Windows. Un lock persistente produce un errore, senza fallback di copia sul file precedente; ritentare esplicitamente dopo aver risolto l'errore. I test di sostituzione rifiutata non certificano perdita di alimentazione o arresto forzato. [Verifica](./verification.md#atomic-state-writer--2026-10-06).

Le nuove ingestion conservano originali e manifest di estrazione in `<userData>/data/source-documents/<doc_id>`; i vecchi documenti non vengono migrati. Limiti: 512 MiB per originale, 10 milioni di code point estratti e 10.000 pagine; il superamento impedisce l'indicizzazione. Copie di ingestion fallite/rifiutate/cancellate e documenti eliminati restano conservate, ma non navigabili senza record e revisioni validi. Backup/export e reclamazione esplicita sono tracciati in `SOURCE-ARCHIVE-LIFECYCLE-01`; non eliminare queste cartelle come semplici file temporanei. Dettagli: [provenienza](./rag-sidecar.md#claimsource-provenance--2026-10-02).

Il disinstallatore mostra «Delete personal data too / Elimina anche i dati personali», disattivato inizialmente. Senza selezione, impostazioni, cronologia e archivio documenti restano disponibili. Una rimozione silenziosa conserva i dati; l'opzione esistente `--delete-app-data` ne richiede esplicitamente la rimozione. Gli aggiornamenti conservano i dati e rifiutano la combinazione `--updated --delete-app-data` con codice 2.

`powershell -ExecutionPolicy Bypass -File scripts/test_uninstall_policy.ps1` compila pagina e macro NSIS in una fixture temporanea con percorsi rediretti. Verifica conservazione, stato di selezione simulato, consenso silenzioso e aggiornamenti, senza usare AppData reale. Richiede il compilatore NSIS nella cache di electron-builder; non sostituisce la verifica visiva della pagina.
