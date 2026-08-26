# Guida di Installazione, Ambiente e Configurazione Hardware — OnlyRag V2

Questo documento costituisce la guida operativa e tecnica di riferimento per l'installazione delle dipendenze, la profilazione hardware (**legacy / entry / midrange / highend / extreme**), il dimensionamento analitico delle risorse (VRAM, RAM, SSD), le variabili d'ambiente di sistema per **Ollama** e i comandi per lo sviluppo, il collaudo e il rilascio di **OnlyRag V2**.

---

## 1. Requisiti di Sistema e Prerequisiti

* **Sistema Operativo:** Windows 10/11 x64 (PowerShell con codifica UTF-8 abilitata).
* **Runtime Node.js:** Node.js 22 LTS o superiore compatibile con il range in `package.json` (npm $\ge 10$).
* **Ambiente Python:** Python 3.12 con modulo standard `venv`.
* **Runtime LLM Locale:** **Ollama** ($\ge 0.5.x$) installato e attivo su `http://127.0.0.1:11434`.
* **Accelerazione Hardware (Opzionale ma Raccomandata):** GPU NVIDIA con supporto CUDA (Architettura Turing, Ampere, Ada Lovelace, Blackwell).

---

## 2. Matrice dei Profili Hardware Host

OnlyRag V2 classifica l'host su 5 tier deterministici definiti in [`hardwareProfileTiers.ts`](../src/services/hardwareProfileTiers.ts) — **unica fonte di verità** condivisa da matrice modelli (`hardwareModelCatalog.ts`), motore di raccomandazione (`hardwareRecommendationEngine.ts`), Routing di Complessità, opzioni di runtime dell'agente, budget di contesto della chat e parametri OS di Ollama. Prima di questo modulo la stessa domanda "quanto è potente questa macchina" veniva risposta da quattro scale di soglie indipendenti che avevano già divergito tra loro; i nomi dei tier (non numeri) sono l'unica nomenclatura valida nel codice — non esiste una numerazione "P1–P5" nell'app.

Un modello puo' comparire come consigliato per un tier solo se `assessModelHardwareCompatibility` non lo classifica `exceeds_vram` su quel tier (invariante verificata dai test).

| Tier | Target Hardware Host | VRAM Dedicata | Safe Budget Pesi ($W_{\text{mem}}$) | RAM di Sistema | Suite Modelli Consigliata (Coding & Multi-Tier) | Storage SSD Richiesto |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`legacy`** | Solo CPU (AVX2), iGPU Intel/AMD | 0 GB (Integrata) | Offload RAM completo, tetto CPU $\le 3.0\text{ GB}$ | 8 – 16 GB | `qwen2.5-coder:1.5b`, `qwen2.5-coder:3b`, `qwen3:4b`, `moondream:latest`, `nomic-embed-text:latest` | 15 – 20 GB |
| **`entry`** | GPU NVIDIA GTX 1660 / RTX 3050, Laptop 4–6GB | 4 – 6 GB | $\le 3.0\text{ GB}$ | 16 – 32 GB | `qwen2.5-coder:1.5b`, `qwen2.5-coder:3b`, `qwen3:4b`, `moondream:latest`, `nomic-embed-text:latest` | 20 – 30 GB |
| **`midrange`** | GPU NVIDIA RTX 2070, RTX 3070, RTX 4060 8GB | 8 – 11 GB | $\le 4.5\text{ GB}$ | 16 – 32 GB | `qwen2.5-coder:1.5b`, `qwen2.5-coder:7b` *(o Q4_K_M)*, `qwen3:8b` *(reasoning + tool calling)*, `moondream:latest`, `nomic-embed-text:latest` | 35 – 50 GB |
| **`highend`**| GPU NVIDIA RTX 3060 12GB, RTX 4070 12GB, RTX 4080 16GB | 12 – 16 GB | $\le 10.5\text{ GB}$ | 32 – 64 GB | `qwen2.5-coder:3b`, `qwen2.5-coder:7b`, `qwen2.5-coder:14b`, `llava:7b`, `bge-m3:latest` | 60 – 90 GB |
| **`extreme`** | GPU NVIDIA RTX 3090 / 4090 (24GB), Multi-GPU, A100/H100 | 24 – 48+ GB | $\ge 16.5\text{ GB}$ | 64 – 128 GB | `qwen2.5-coder:14b`, `gpt-oss:20b`, `codestral:22b`, `qwen3-coder:30b` *(48GB+)*, `llama3.2-vision:11b` | 120 – 250 GB |

> [!NOTE]
> **Perche' `extreme` non consiglia piu' un 32B su una scheda da 24GB:**
> Con budget netto sicuro di $16.5\text{ GB}$, un modello Q4 da 32B (~20 GB di soli pesi) supera la soglia e verrebbe marcato `exceeds_vram` dallo stesso motore che lo proponeva. La scelta predefinita passa a **`gpt-oss:20b`** (~13.5 GB), che resta interamente in VRAM; i 32B restano selezionabili e diventano il primo candidato della cascata su schede da 32GB+.

> [!IMPORTANT]
> **Ottimizzazione GPU da 8GB (es. RTX 2070 / RTX 3070 / RTX 4060):**
> Con VRAM netta sicura di $4.5\text{ GB}$ (dopo riserva DWM di $1.5\text{ GB}$ e margine di sicurezza del $25\%$), i modelli **`qwen2.5-coder:7b`** (4.7 GB) e le sue quantizzazioni **`qwen2.5-coder:7b-instruct-q4_k_m`** (4.4 GB) o **`qwen3:8b`** (5.2 GB, con supporto nativo al tool calling) operano stabilmente in VRAM offrendo massima precisione architetturale per il coding agent senza rischiare crash OOM o loop di comandi non supportati.

> [!NOTE]
> **Impatto sistema in tempo reale:** la formula $Footprint_{\text{Totale}} = W_{\text{mem}} + KV_{\text{mem}} + Overhead_{\text{CUDA}}$ (§3) e' calcolata da `assessModelHardwareCompatibility` in `hardwareRecommendationEngine.ts` e popola il campo `compatibilityStatus` di `ModelRecommendation` (`optimal_vram` / `tight_vram` / `exceeds_vram`). Il valore governa il ranking e la selezione dei modelli consigliati per ogni tier ed e' **esposto in UI** nel Setup Wizard (`WizardStepRecommendedModels.tsx`): ogni voce dei `select` riporta, dopo lo stato di download, il footprint stimato e il verdetto VRAM (`● entra in VRAM` / `⚠ al limite VRAM` / `⛔ oltre la VRAM`). Poiche' un `<option>` nativo rende solo testo, il badge e' testuale e non stilizzato. Le opzioni preset del wizard non appartengono tutte ai cataloghi, quindi il verdetto e' calcolato on demand da `buildModelFitLookup` (`hardwareRecommendationEngine.ts`), che memoizza `assessModelHardwareCompatibility` per qualunque tag di modello sull'host rilevato.

> [!NOTE]
> **Modelli specialistici Medical & Legal:** entrambi i domini hanno un catalogo dedicato gia' popolato su tutti i 5 tier (`MEDICAL_TIER_CATALOG` / `LEGAL_TIER_CATALOG` in `hardwareModelCatalog.ts`) con fallback agnostico `llama3.2:3b` su legacy/entry/midrange e modelli specializzati (`biomistral`/`llama3.1:8b`/`mistral-small3.2:24b`) su highend/extreme, selezionabili dalla suite consigliata del Setup Wizard a 3 step (`WizardStepRecommendedModels.tsx`) e dalle Impostazioni.

---

## 3. Formule di Dimensionamento Analitico delle Risorse

### 3.1. Impronta in Memoria dei Pesi del Modello ($W_{\text{mem}}$)
$$W_{\text{mem}} \text{ (GB)} \approx \left(\text{Parametri in Miliardi} \times \frac{\text{Bit di Quantizzazione}}{8}\right) \times 1.12$$
*Il moltiplicatore $1.12$ copre l'overhead di caricamento dei layer e delle matrici di calcolo GGUF.*

### 3.2. Memoria KV-Cache della Context Window ($KV_{\text{mem}}$)
$$KV_{\text{mem}} \text{ (GB)} = 2 \times N_{\text{layers}} \times N_{\text{heads}} \times d_{\text{head}} \times \text{num\_ctx} \times \text{BytesPerElem}$$
* **KV-Cache standard FP16:** $\text{BytesPerElem} = 2$ bytes.
* **KV-Cache quantizzata (`OLLAMA_KV_CACHE_TYPE=q8_0`):** $\text{BytesPerElem} = 1$ byte (**dimezza del 50% il consumo di VRAM**).

### 3.3. Safe Net VRAM Budget & Pre-Flight Storage Check
$$VRAM_{\text{Disponibile\_Reale}} = \max\left(0, (VRAM_{\text{Totale}} \times (1 - \text{Safety\_Margin})) - \text{Overhead\_OS}\right)$$
dove:
- $\text{Safety\_Margin} = 0.25 \quad (25\% \text{ buffer anti-choke})$
- $\text{Overhead\_OS} = 1.5\text{ GB} \quad (\text{DWM.exe, driver display, background processes})$

Condizione di ammissibilità per i modelli e le quantizzazioni:
$$\text{Footprint\_Totale} = VRAM_{\text{Modello}}(\text{Quant}) + VRAM_{\text{KV\_Cache}}(C_{\text{target}}) + \text{Overhead\_CUDA} \le VRAM_{\text{Disponibile\_Reale}}$$

Prima del download dei modelli, il sistema verifica lo storage libero su disco:
$$S_{\text{free\_disk}} \ge \sum_{i=1}^{n} \text{Size}_{\text{model}_i} \times 1.25$$

---

## 4. Ottimizzazione Sistema Operativo & Variabili d'Ambiente Ollama

Per massimizzare il throughput (token/s) ed eliminare i freeze su Windows, configurare le variabili d'ambiente di sistema per Ollama:

| Variabile | Valore Raccomandato | Tier HW | Beneficio Tecnico |
| :--- | :--- | :--- | :--- |
| `OLLAMA_FLASH_ATTENTION` | `1` | entry – extreme (NVIDIA GPU) | Abilita i kernel Flash Attention CUDA. Dimezza la memoria dei buffer e accelera l'inferenza. |
| `OLLAMA_KV_CACHE_TYPE` | `q8_0` | legacy, entry, midrange (GPU $\le$ 10GB) | Quantizza la KV-Cache a 8 bit, risparmiando fino al 50% di VRAM nei contesti lunghi (4k–16k). |
| `OLLAMA_KV_CACHE_TYPE` | `f16` | highend, extreme (GPU $\ge$ 12GB) | Massima fedeltà numerica Float16 su schede con ampio buffer di memoria. |
| `OLLAMA_MAX_LOADED_MODELS`| `1` | legacy, entry, midrange | Mantiene 1 solo modello attivo in VRAM per scaricare i modelli inattivi e liberare memoria. |
| `OLLAMA_MAX_LOADED_MODELS`| `2` | highend, extreme | Mantiene in VRAM sia il modello di Embedding sia l'LLM per risposta a latenza zero. |
| `OLLAMA_NUM_PARALLEL` | `1` | legacy, entry, midrange | Elabora 1 richiesta alla volta per prevenire picchi improvvisi e Out-Of-Memory. |
| `OLLAMA_NUM_PARALLEL` | `2` – `4` | highend, extreme | Consente stream paralleli concorrenti per tool calling ed embedding. |
| `OLLAMA_KEEP_ALIVE` | `30m` | entry, midrange, highend | Mantiene il modello principale in VRAM per 30 minuti evitando frequenti ricaricamenti. |
| `OLLAMA_KEEP_ALIVE` | `5m` | legacy / hardware minimo | Libera rapidamente la RAM di sistema dopo brevi sessioni di inattivita'. |
| `OLLAMA_CONTEXT_LENGTH` | `4096` – `32768` | Tutti (scala per tier) | Finestra di contesto predefinita lato server. Senza questa variabile un host minimo alloca una KV-Cache molto piu' grande del necessario ad ogni richiesta che non specifica `num_ctx`. |
| `OLLAMA_GPU_OVERHEAD` | `1610612736` (1.5 GB) | entry – extreme (NVIDIA GPU) | Riserva a Ollama lo stesso margine DWM usato da `calculateRealUsableVram`, allineando il pianificatore di offload dei layer al budget calcolato dall'app. |
| `OLLAMA_HOST` | `127.0.0.1:11434` | Tutti | Ascolto su interfaccia di loopback locale protetta da accessi di rete esterni. |

> [!WARNING]
> `OLLAMA_KV_CACHE_TYPE` viene onorato da Ollama **solo** con `OLLAMA_FLASH_ATTENTION=1`. Sui profili senza GPU la variabile non viene piu' generata, perche' sarebbe inerte.

### Script di Configurazione Rapida 1-Click (PowerShell)

Eseguire in **PowerShell come Utente** per rendere le impostazioni permanenti:

```powershell
# 1. Impostazione variabili d'ambiente utente permanenti
[System.Environment]::SetEnvironmentVariable('OLLAMA_FLASH_ATTENTION', '1', 'User')
[System.Environment]::SetEnvironmentVariable('OLLAMA_KV_CACHE_TYPE', 'q8_0', 'User')
[System.Environment]::SetEnvironmentVariable('OLLAMA_MAX_LOADED_MODELS', '1', 'User')
[System.Environment]::SetEnvironmentVariable('OLLAMA_NUM_PARALLEL', '1', 'User')
[System.Environment]::SetEnvironmentVariable('OLLAMA_KEEP_ALIVE', '30m', 'User')
[System.Environment]::SetEnvironmentVariable('OLLAMA_HOST', '127.0.0.1:11434', 'User')

# 2. Riavvio daemon Ollama
Stop-Process -Name "ollama*" -Force -ErrorAction SilentlyContinue
Start-Process -FilePath "$env:LOCALAPPDATA\Programs\Ollama\ollama app.exe"
Write-Host "Configurazione Ollama applicata con successo!" -ForegroundColor Green
```

---

## 5. Guida di Installazione Passo-Passo

### 1. Clonazione del Repository
```powershell
git clone https://github.com/dennidalpos/OnlyRagV2.git
cd OnlyRagV2
```

### 2. Installazione Dipendenze Node.js (Electron & React)
```powershell
npm run setup:dev
```

### 3. Configurazione Virtual Environment Python (Sidecar)
Lo script risolve la root da `$PSScriptRoot`, quindi funziona anche se lanciato da una directory diversa dalla cartella del repository. Crea `.venv` con Python 3.12 e installa `sidecar/requirements-dev.txt`, che include runtime, `pytest` e `pyinstaller`.

---

## 6. Comandi di Sviluppo, Test, Pulizia e Packaging

Tutti i comandi devono essere eseguiti **rigorosamente in sequenza** su PowerShell:

### Sviluppo Locale
```powershell
# Avvia contemporaneamente Vite HMR, Electron Main e FastAPI Sidecar
npm run dev
```

### Controllo Statico dei Tipi (TypeScript)
```powershell
npm run typecheck
```

### Suite di Test Unitari ed Integrazione
```powershell
# Test veloci in modalità riassuntiva Fast (consigliata per agenti)
npm run test:fast

# Test ultrarapidi solo logica di dominio e applicazione
npm run test:unit-only

# Esecuzione completa suite Vitest
npm test

# Test Pytest su endpoint e logica del Python Sidecar
npm run test:sidecar
```

### Run Live del Coding Agent
```powershell
# Sessioni reali contro un modello Ollama, senza UI (minuti, non secondi)
npm run test:live
```

Fuori dalla suite normale per costruzione: gli scenari stanno in `scripts/live/*.live.ts` con una config dedicata (`vitest.live.config.mts`), perche' un file live sotto `electron/**` verrebbe raccolto da `npm test` e, con `isolate: false`, smonterebbe le directory temporanee usate dagli altri test. Richiedono Ollama attivo e le impostazioni reali dell'app. Vedi [`agent-live-testing.md`](./agent-live-testing.md).

La suite Python gira sempre su uno store LanceDB temporaneo isolato: `sidecar/tests/conftest.py` imposta `ONLYRAG_DATA_DIR` su una directory temporanea **prima** di qualsiasi import di `sidecar.config`, che risolve i percorsi dati a import-time. Senza quell'override i test scrivevano nello store reale dell'utente. Ogni tabella LanceDB viene inoltre eliminata fra un test e l'altro, perche' la connessione e' a livello di processo.

### Script di Automazione e Qualità (`scripts/`)
```powershell
# Verifica whitespace sul diff rispetto a HEAD
npm run format:check

# Gate seriale del repository (JSON + TypeScript + sintassi Python + Vitest + Smoke Test)
.\scripts\lint_format.ps1 -Fast

# Suite Pytest del sidecar, separata dal gate npm
npm run test:sidecar

# Audit architettura e code hygiene completo (dpdm + knip + skott)
npm run audit:all
# Audit mirati: dipendenze circolari, dead code, o grafo visuale
npm run audit:cycles
npm run audit:deadcode
npm run audit:graph

# Pulizia selettiva e factory reset
npm run clean        # Pulisce gli artifact temporanei di build nel repository
npm run clean:logs   # Termina i processi attivi e pulisce tutti i file di log
npm run clean:user   # Pulisce i dati locali in AppData (LanceDB e impostazioni)
npm run clean:full   # Factory reset completo (Repo + Logs + UserData)

# Verifica dello stato di salute del sidecar locale
.\scripts\test_sidecar_health.ps1 -Fast
```

Gli script di automazione falliscono esplicitamente se mancano comandi, directory o file richiesti;
il controllo CI verifica anche gli exit code di `npm ci` e dell'installazione Python. Il controllo
Pytest esegue una sola prova e conserva stderr, senza retry diagnostici o passaggi silenziosi.
`npm run format:check` verifica il whitespace del diff con `git diff --check HEAD`; non è un
formatter AST. Non esiste ancora un gate coverage: prima di introdurlo servono un provider Vitest
compatibile e una baseline misurata, per evitare soglie arbitrarie o test più lenti del gate rapido.

### Build di Produzione e Creazione Installer NSIS
```powershell
# Compilazione e creazione pacchetto installer Windows
npm run build
npm run package:win
```
L'installer compilato verrà generato in `dist/OnlyRag V2 Setup 1.0.0.exe`.

### Dipendenze Runtime vs Build
`dependencies` contiene solo `node-pty`, l'unico modulo nativo caricato a runtime dal main process (`taskRunner.ts`). Le librerie del renderer (`react`, `react-dom`, `lucide-react`, `@monaco-editor/react`) sono `devDependencies`: vengono incluse nel bundle Vite e non devono finire in `app.asar` come moduli separati.

### Firma Authenticode dell'Installer
Lo script di packaging verifica sempre lo stato della firma dell'artifact prodotto e, se manca, stampa un warning esplicito: senza firma Windows SmartScreen mostra l'avviso "Editore sconosciuto" alla prima esecuzione.

Per produrre un installer firmato servono un certificato di code signing e due variabili d'ambiente lette da electron-builder — **da non committare mai nel repository**:

```powershell
# Percorso del certificato .pfx e relativa password (solo nella sessione di build)
$env:CSC_LINK = "C:\percorso\certificato.pfx"
$env:CSC_KEY_PASSWORD = "<password del certificato>"

# Build di distribuzione: fallisce se l'installer risulta non firmato
.\scripts\build_package.ps1 -RequireSignature
```

Senza `-RequireSignature` la build resta consentita e produce un installer non firmato, adatto a test locali.
