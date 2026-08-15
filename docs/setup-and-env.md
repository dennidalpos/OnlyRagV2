# Guida di Installazione, Ambiente e Configurazione Hardware — OnlyRag V2

Questo documento costituisce la guida operativa e tecnica di riferimento per l'installazione delle dipendenze, la profilazione hardware (**P1 – P5**), il dimensionamento analitico delle risorse (VRAM, RAM, SSD), le variabili d'ambiente di sistema per **Ollama** e i comandi per lo sviluppo, il collaudo e il rilascio di **OnlyRag V2**.

---

## 1. Requisiti di Sistema e Prerequisiti

* **Sistema Operativo:** Windows 10/11 x64 (PowerShell con codifica UTF-8 abilitata).
* **Runtime Node.js:** Node.js $\ge 18.x$ e npm $\ge 9.x$.
* **Ambiente Python:** Python $\ge 3.10$ con modulo standard `venv`.
* **Runtime LLM Locale:** **Ollama** ($\ge 0.5.x$) installato e attivo su `http://127.0.0.1:11434`.
* **Accelerazione Hardware (Opzionale ma Raccomandata):** GPU NVIDIA con supporto CUDA (Architettura Turing, Ampere, Ada Lovelace, Blackwell).

---

## 2. Matrice dei Profili Hardware Host (Presets P1 – P5)

OnlyRag V2 include un motore deterministico di calcolo delle risorse ([`hardwareRecommendationEngine.ts`](../src/services/hardwareRecommendationEngine.ts)) che assegna automaticamente la suite di modelli ottimali prevenendo il blocco del driver grafico di Windows (DWM) e l'esaurimento della memoria:

| Profilo | Target Hardware Host | VRAM Dedicata | Safe Budget Pesi ($W_{\text{mem}}$) | RAM di Sistema | Suite Modelli Consigliata (Coding & Multi-Tier) | Storage SSD Richiesto |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **P1: Ultra-Light** | Solo CPU (AVX2), iGPU Intel/AMD | 0 GB (Integrata) | Offload RAM completo | 8 – 16 GB | `qwen2.5-coder:1.5b`, `qwen2.5-coder:3b`, `deepseek-coder:6.7b`, `moondream:latest`, `nomic-embed-text:latest` | 15 – 20 GB |
| **P2: Entry-Level** | GPU NVIDIA GTX 1660 / RTX 3050, Laptop 4–6GB | 4 – 6 GB | $\le 3.0\text{ GB}$ | 16 – 32 GB | `qwen2.5-coder:1.5b`, `qwen2.5-coder:3b`, `deepseek-coder:6.7b`, `moondream:latest`, `nomic-embed-text:latest` | 20 – 30 GB |
| **P3: Mid-Tier** | GPU NVIDIA RTX 2070, RTX 3070, RTX 4060 8GB | 8 – 11 GB | $\le 4.5\text{ GB}$ | 16 – 32 GB | `qwen2.5-coder:1.5b`, `qwen2.5-coder:7b` *(o Q4_K_M)*, `deepseek-r1:7b` *(distill Qwen)*, `moondream:latest`, `nomic-embed-text:latest` | 35 – 50 GB |
| **P4: High-End Pro**| GPU NVIDIA RTX 3060 12GB, RTX 4070 12GB, RTX 4080 16GB | 12 – 16 GB | $\le 10.5\text{ GB}$ | 32 – 64 GB | `qwen2.5-coder:3b`, `qwen2.5-coder:7b`, `qwen2.5-coder:14b` / `deepseek-r1:14b`, `llava:7b`, `bge-m3:latest` | 60 – 90 GB |
| **P5: Enterprise** | GPU NVIDIA RTX 3090 / 4090 (24GB), Multi-GPU, A100/H100 | 24 – 48+ GB | $\ge 16.5\text{ GB}$ | 64 – 128 GB | `qwen2.5-coder:14b`, `qwen2.5-coder:32b`, `deepseek-r1:32b`, `codestral:22b`, `llama3.2-vision:11b` | 120 – 250 GB |

> [!IMPORTANT]
> **Ottimizzazione GPU da 8GB (es. RTX 2070 / RTX 3070 / RTX 4060):**
> Con VRAM netta sicura di $4.5\text{ GB}$ (dopo riserva DWM di $1.5\text{ GB}$ e margine di sicurezza del $25\%$), i modelli **`qwen2.5-coder:7b`** (4.7 GB) e le sue quantizzazioni **`qwen2.5-coder:7b-instruct-q4_k_m`** (4.4 GB) e **`deepseek-r1:7b`** (4.7 GB, distillato su Qwen Math/Code) operano stabilmente in VRAM offrendo massima precisione architetturale per il coding senza rischiare crash OOM.

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

| Variabile | Valore Raccomandato | Profilo HW | Beneficio Tecnico |
| :--- | :--- | :--- | :--- |
| `OLLAMA_FLASH_ATTENTION` | `1` | P2 – P5 (NVIDIA GPU) | Abilita i kernel Flash Attention CUDA. Dimezza la memoria dei buffer e accelera l'inferenza. |
| `OLLAMA_KV_CACHE_TYPE` | `q8_0` | P1, P2, P3 (GPU $\le$ 10GB) | Quantizza la KV-Cache a 8 bit, risparmiando fino al 50% di VRAM nei contesti lunghi (4k–16k). |
| `OLLAMA_KV_CACHE_TYPE` | `f16` | P4, P5 (GPU $\ge$ 12GB) | Massima fedeltà numerica Float16 su schede con ampio buffer di memoria. |
| `OLLAMA_MAX_LOADED_MODELS`| `1` | P1, P2, P3 | Mantiene 1 solo modello attivo in VRAM per scaricare i modelli inattivi e liberare memoria. |
| `OLLAMA_MAX_LOADED_MODELS`| `2` | P4, P5 | Mantiene in VRAM sia il modello di Embedding sia l'LLM per risposta a latenza zero. |
| `OLLAMA_NUM_PARALLEL` | `1` | P1, P2, P3 | Elabora 1 richiesta alla volta per prevenire picchi improvvisi e Out-Of-Memory. |
| `OLLAMA_NUM_PARALLEL` | `2` – `4` | P4, P5 | Consente stream paralleli concorrenti per tool calling ed embedding. |
| `OLLAMA_KEEP_ALIVE` | `30m` | P2, P3, P4 | Mantiene il modello principale in VRAM per 30 minuti evitando frequenti ricaricamenti. |
| `OLLAMA_HOST` | `127.0.0.1:11434` | Tutti | Ascolto su interfaccia di loopback locale protetta da accessi di rete esterni. |

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
npm install
```

### 3. Configurazione Virtual Environment Python (Sidecar)
```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r sidecar/requirements.txt
```

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

### Script di Automazione e Qualità (`scripts/`)
```powershell
# Validazione completa seriale (TypeScript + Vitest + Pytest)
.\scripts\lint_format.ps1 -Fast

# Pulizia sicura del workspace e delle cache temporanee
npm run clean

# Pulizia completa di fabbrica (incluso database LanceDB in AppData)
npm run clean:full

# Verifica dello stato di salute del sidecar locale
.\scripts\test_sidecar_health.ps1 -Fast
```

### Build di Produzione e Creazione Installer NSIS
```powershell
# Compilazione e creazione pacchetto installer Windows
npm run build
npm run package:win
```
L'installer compilato verrà generato in `dist/OnlyRag V2 Setup 1.0.0.exe`.
