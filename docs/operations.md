# Operazioni, Setup & Toolchain di Verifica — OnlyRag V2

Questo documento raccoglie tutti i requisiti di ambiente, il catalogo dei comandi verificati, le procedure di packaging Windows e i quality gate automatici di OnlyRag V2.

---

## 1. Prerequisiti di Ambiente

| Strumento | Versione Minima | Note |
| :--- | :--- | :--- |
| **Node.js** | `>=24.19.0 <25` | Conforme a `.nvmrc` ed `engines` in `package.json`. |
| **npm** | `>=11 <12` | Gestore pacchetti per il progetto Electron/React. |
| **Python** | `3.12.x` | Ambiente virtuale locale in `.venv` per il FastAPI Sidecar. |
| **Ollama** | `>=0.3.0` | Runtime LLM locale in ascolto su `http://127.0.0.1:11434`. |
| **PowerShell** | `7.x (pwsh)` o `5.1` | Shell di riferimento per gli script di build e audit. |

### Setup Iniziale
Per configurare automaticamente l'intero ambiente (creazione `.venv`, installazione dipendenze Node e Python):
```pwsh
npm run setup:dev
```

---

## 2. Catalogo dei Comandi Verificati

Tutti i comandi elencati sono registrati in [`package.json`](../package.json) e verificati con `npm run docs:check`:

| Workflow | Comando | Descrizione |
| :--- | :--- | :--- |
| **Sviluppo Locale** | `npm run dev` | Avvia il server Vite in modalità dev con hot-reload. |
| **Build Locale** | `npm run build` | Compila TypeScript e i bundle Renderer, Main e Preload senza richiedere il sidecar release. |
| **Verifica Veloce** | `npm run test:fast` | Esegue 1902 test in 230 file con Vitest (~3 min). |
| **Unit Test Singoli** | `npx vitest run <path>` | Esegue un singolo target di test. |
| **Verifica Tipi** | `npm run typecheck` | Esegue `tsc --noEmit` su Main, Preload e Renderer. |
| **Qualità Statica** | `npm run quality:static` | Esegue Biome 2.5.12: lint su tutto il codice e format check sui file nuovi. |
| **Controllo Formattazione** | `npm run format:check` | Verifica marker di conflitto git e whitespace (`git diff --check`). |
| **Audit Codice Completo** | `npm run audit:all` | Script PowerShell che verifica tipi, test, deadcode e cicli architetturali. |
| **Audit Cicli di Import** | `npm run audit:cycles` | Rileva dipendenze circolari con dpdm (garanzia 0 cicli). |
| **Audit Dead Code** | `npm run audit:deadcode` | Rileva file orfani ed export inutilizzati con Knip. |
| **Controllo Documentazione** | `npm run docs:check` | Valida link relativi nei file `.md` e comandi citati. |
| **Test Sidecar** | `npm run test:sidecar` | Esegue la suite di test pytest del FastAPI Sidecar. |
| **Rigenera OpenAPI** | `npm run generate:openapi` | Rigenera il contratto machine-readable `openapi-2.3.0.json`. |
| **Verifica Asset** | `npm run assets:check` | Verifica PNG/SVG sincronizzati e frame ICO 16–256 px senza scrivere file. |
| **Generazione Asset** | `npm run assets:generate` | Rigenera l'ICO multi-risoluzione e sincronizza le icone pubbliche. |
| **Packaging Windows** | `npm run package:win` | Valida asset, compila sidecar e bundle, crea l'installer NSIS e riporta firma e SHA-256. |
| **Pulizia Repository** | `npm run clean` | Rimuove solo output e cache rigenerabili, preservando dipendenze e dati locali. |
| **Pulizia Test** | `npm run clean:tests` | Rimuove residui OnlyRag in `%TEMP%`, dati test locali e workspace live sul Desktop. |
| **Pulizia Cache Installer** | `npm run clean:installer-cache` | Rimuove la cache updater senza toccare app installata o impostazioni. |
| **Reset Completo** | `npm run clean:full` | Operazione distruttiva: include dati utente, impostazioni e LanceDB oltre a tutte le cache. |

---

## 3. Script PowerShell di Automazione (`scripts/`)

Gli script PowerShell operano con policy rigorosa **Fail-Fast** (`$ErrorActionPreference = 'Stop'`):

* **[`scripts/audit_codebase.ps1`](../scripts/audit_codebase.ps1)**: Esegue in sequenza fail-fast: typecheck TypeScript, analisi dead code con Knip, controllo del grafo delle dipendenze con Skott, rilevamento cicli con DPDM e suite test.
* **[`scripts/build_package.ps1`](../scripts/build_package.ps1)**: Valida gli asset, compila il Sidecar con PyInstaller, crea l'installer NSIS, ne verifica il contenuto e riporta firma e SHA-256.
* **[`scripts/generate_assets.ps1`](../scripts/generate_assets.ps1)**: Genera l'ICO multi-frame tramite API .NET e mantiene sincronizzate le copie in `public/`, senza dipendenze grafiche esterne.
* **[`scripts/clean_repo.ps1`](../scripts/clean_repo.ps1)**: Rimuove esclusivamente output e cache rigenerabili contenuti nel repository.
* **[`scripts/clean_workspace.ps1`](../scripts/clean_workspace.ps1)**: Gestisce separatamente log, residui test, cache installer e dati utente con target validati e supporto `-WhatIf`.
* **[`scripts/setup_dev_environment.ps1`](../scripts/setup_dev_environment.ps1)**: Inizializza l'ambiente di sviluppo, controlla le versioni di Node/Python, crea il virtualenv e installa le dipendenze.
* **[`scripts/check_static_quality.mjs`](../scripts/check_static_quality.mjs)**: Esegue il lint Biome sull'intero repository e limita il formatter ai file aggiunti rispetto alla base CI; i file legacy modificati restano coperti da `format:check` finché non vengono migrati esplicitamente.
* **[`scripts/validate_documentation.mjs`](../scripts/validate_documentation.mjs)**: Controlla che tutti i collegamenti ipertestuali tra i documenti `.md` esistano e che ogni invocazione `npm run <script>` esista in `package.json`.

---

## 4. Quality Gates & Policy di Verifica

1. **Zero Regressioni**: Nessuna modifica può essere considerata conclusa se `npm run test:fast` o `npm run typecheck` falliscono.
2. **Zero Cicli Architetturali**: La struttura deve rispettare l'isolamento dei livelli: zero import diretti tra Renderer e Main.
3. **Integrità Documentale**: `npm run docs:check` deve sempre terminare con esito positivo prima di ogni rilascio.
4. **Analisi Statica Separata**: la CI esegue `npm run quality:static` prima del gate composito; [`biome.json`](../biome.json) abilita il preset correctness e regole anti-duplicazione, lasciando a TypeScript i controlli unused già attivi. Knip esclude esplicitamente `@biomejs/biome`, invocato dal percorso dinamico in `scripts/check_static_quality.mjs` che l'analisi statica non risolve.
