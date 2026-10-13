# Setup e operazioni

Eseguire i comandi da PowerShell nella radice del repository. Le versioni dichiarate sono Node [`24.19.0`](../.nvmrc), npm `>=11 <12` in [`package.json`](../package.json) e Python [`3.13.15`](../.python-version). Lo sviluppo richiede Ollama; l'endpoint locale predefinito è `http://127.0.0.1:11434`. Il manifest degli script e i loro effetti sono in [`package.json`](../package.json) e [`scripts/`](../scripts/).

## Comandi

| Scopo | Comando | Effetto e stato |
| --- | --- | --- |
| Setup | `npm run setup:dev` | Installa dipendenze e runtime di sviluppo; comando documentato dal manifest, non rieseguito in questa revisione. |
| Avvio | `npm run dev` | Avvia Vite/Electron e il Sidecar; può leggere il profilo di sviluppo. Non rieseguito qui. |
| Documentazione | `npm run docs:check` | Controlla link, ancoraggi Markdown e nomi degli script. Verificato in questa revisione. |
| Tipi/statico | `npm run typecheck`, `npm run quality:static` | Controlli sorgente; eseguire se cambiano contratti o codice. Non necessari per sole pagine Markdown. |
| Test mirati | `npx vitest run <percorso>`; `.venv\Scripts\python.exe -m pytest -q <percorso>` | Usare per problemi concreti, con fixture isolate. |
| Suite complete | `npm run test:fast -- --silent=true`; `.venv\Scripts\python.exe -m pytest -q` | Solo quando un problema o un gate di rilascio lo richiede; le ultime ricevute sono in [`verification-current.md`](./verification-current.md). |
| Build | `npm run build` | Genera bundle locali. Non rieseguito qui. |
| OpenAPI | `npm run generate:openapi` | Rigenera il contratto dopo modifiche REST. Non rieseguito qui. |
| Installer | `npm run package:win` | Crea un nuovo candidato CPU in `release/cpu-*`; non installa né pubblica. Non rieseguito qui. |

La CI Windows in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) installa il runtime Electron anche con `node node_modules/electron/install.js`. Test e build non qualificano modelli, semantica, profili personali o perdita di alimentazione.

## Offline embedding store maintenance — 2026-10-10

[`scripts/rebuild_embeddings.py`](../scripts/rebuild_embeddings.py) espone `preview`, `prepare`, `activate` e `rollback`, sempre con `--root` esplicito. `prepare` richiede un encoder nativo selezionato, conserva backup, originali e candidato; `activate` cambia il puntatore versionato solo dopo readback. Operazioni fallite mantengono gli artefatti e restituiscono errore. Chiudere l'app prima della manutenzione, soprattutto per runtime precedenti che non condividono il lease. Nessun esempio di comando autorizza un rebuild personale. Contratto e limiti in [`retrieval.md`](./retrieval.md); prova datata in [`verification.md`](./verification.md#offline-embedding-store-rebuild--2026-10-10).

## Cleanup safety policy — 2026-10-10

[`clean_repo.ps1`](../scripts/clean_repo.ps1), [`clean_workspace.ps1`](../scripts/clean_workspace.ps1) e [`cleanup_policy.ps1`](../scripts/cleanup_policy.ps1) rifiutano percorsi non ammessi, reparse point, file tracciati e dati protetti. I modi Repo, TestResidues e Full richiedono `-DisposablePaths` con percorsi assoluti esaminati; Full esclude i profili. `-WhatIf` applica il preflight senza cancellare. `StopAppProcesses` rifiuta: chiudere l'app deliberatamente. Non classificare `.onlyrag`, `userdata_dev`, campagne live, checkpoint, backup o vecchi scratch come eliminabili dal nome. Eventuali residui hanno una decisione separata nel tracker (`RETAINED-RESIDUE-DISPOSAL-01`). Nessuna pulizia reale è stata eseguita per questa revisione.

## Disinstallazione e dati

La configurazione NSIS ha `deleteAppDataOnUninstall: false` in [`package.json`](../package.json). L'installer locale è non firmato per default; `-RequireSignature` richiede una firma valida, mentre `-SkipSidecar` è rifiutato. Stato di licenze, sorgenti e aggiornamento in [`distribution.md`](./distribution.md).
