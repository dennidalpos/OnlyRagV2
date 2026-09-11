# Setup, test e release

## Prerequisiti

- Windows 10/11 64-bit.
- Node `>=24.19.0 <25` e npm `>=11 <12` (`.nvmrc`, `package.json`).
- Python `3.12.10` (`.python-version`).
- Ollama installato, con endpoint predefinito `http://127.0.0.1:11434`.

Setup: `npm run setup:dev`.

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
| OpenAPI | `npm run generate:openapi` |
| Asset | `npm run assets:check`, `npm run assets:generate` |
| Installer | `npm run package:win` |

Target Vitest: `npx vitest run <path>`.

## Script di supporto

- `setup_dev_environment.ps1`: Node, Python, virtualenv e dipendenze.
- `audit_codebase.ps1`: typecheck, test, dead code e grafo.
- `build_package.ps1`: Sidecar PyInstaller, bundle e installer NSIS.
- `test_bundle_smoke.ps1`: avvio isolato del bundle e marker smoke.
- `clean_repo.ps1` e `clean_workspace.ps1`: pulizie separate con target espliciti.

I comandi distruttivi (`clean:full`) richiedono attenzione: possono rimuovere dati utente locali.
