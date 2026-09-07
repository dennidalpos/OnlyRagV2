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
| **Verifica Veloce** | `npm run test:fast` | Esegue la suite completa di 1841 unit test con Vitest (~2.5 min). |
| **Unit Test Singoli** | `npx vitest run <path>` | Esegue un singolo target di test. |
| **Verifica Tipi** | `npm run typecheck` | Esegue `tsc --noEmit` su Main, Preload e Renderer. |
| **Controllo Formattazione** | `npm run format:check` | Verifica marker di conflitto git e whitespace (`git diff --check`). |
| **Audit Codice Completo** | `npm run audit:all` | Script PowerShell che verifica tipi, test, deadcode e cicli architetturali. |
| **Audit Cicli di Import** | `npm run audit:cycles` | Rileva dipendenze circolari con dpdm (garanzia 0 cicli). |
| **Audit Dead Code** | `npm run audit:deadcode` | Rileva file orfani ed export inutilizzati con Knip. |
| **Controllo Documentazione** | `npm run docs:check` | Valida link relativi nei file `.md` e comandi citati. |
| **Test Sidecar** | `npm run test:sidecar` | Esegue la suite di test pytest del FastAPI Sidecar. |
| **Rigenera OpenAPI** | `npm run generate:openapi` | Rigenera il contratto machine-readable `openapi-2.3.0.json`. |
| **Packaging Windows** | `npm run package:win` | Compila sidecar PyInstaller, bundle Vite ed installer NSIS. |
| **Pulizia Workspace** | `npm run clean:full` | Rimuove log, cache temporanee e artefatti di build. |

---

## 3. Script PowerShell di Automazione (`scripts/`)

Gli script PowerShell operano con policy rigorosa **Fail-Fast** (`$ErrorActionPreference = 'Stop'`):

* **[`scripts/audit_codebase.ps1`](../scripts/audit_codebase.ps1)**: Esegue in sequenza fail-fast: typecheck TypeScript, analisi dead code con Knip, controllo del grafo delle dipendenze con Skott, rilevamento cicli con DPDM e suite test.
* **[`scripts/build_package.ps1`](../scripts/build_package.ps1)**: Compila l'eseguibile standalone del FastAPI Sidecar con PyInstaller, effettua la build di produzione Vite/TypeScript e crea l'installer eseguibile NSIS per Windows.
* **[`scripts/setup_dev_environment.ps1`](../scripts/setup_dev_environment.ps1)**: Inizializza l'ambiente di sviluppo, controlla le versioni di Node/Python, crea il virtualenv e installa le dipendenze.
* **[`scripts/validate_documentation.mjs`](../scripts/validate_documentation.mjs)**: Controlla che tutti i collegamenti ipertestuali tra i documenti `.md` esistano e che ogni invocazione `npm run <script>` esista in `package.json`.

---

## 4. Quality Gates & Policy di Verifica

1. **Zero Regressioni**: Nessuna modifica può essere considerata conclusa se `npm run test:fast` o `npm run typecheck` falliscono.
2. **Zero Cicli Architetturali**: La struttura deve rispettare l'isolamento dei livelli: zero import diretti tra Renderer e Main.
3. **Integrità Documentale**: `npm run docs:check` deve sempre terminare con esito positivo prima di ogni rilascio.
