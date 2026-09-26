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

Target Vitest: `npx vitest run <path>`.

## Script di supporto

- `setup_dev_environment.ps1`: Node, Python, virtualenv e dipendenze.
- `audit_codebase.ps1`: typecheck, test, dead code e grafo.
- `build_package.ps1`: Sidecar PyInstaller, bundle e installer NSIS.
- `test_bundle_smoke.ps1`: avvio del bundle con una `userData` temporanea (rimossa a fine esecuzione) e marker smoke cercato nel suo `logs/app.log`.
- `clean_repo.ps1` e `clean_workspace.ps1`: pulizie separate con target espliciti.

I comandi distruttivi (`clean:full`) richiedono attenzione: possono rimuovere dati utente locali.
