# Guida di Installazione, Ambiente e Comandi — OnlyRag V2

Questo documento fornisce le istruzioni operative per l'installazione delle dipendenze, la configurazione dell'ambiente hardware e i comandi per lo sviluppo, il collaudo e il rilascio di OnlyRag V2.

---

## 1. Requisiti di Sistema e Matrice Hardware

### Requisiti Minimi di Sistema
* **Sistema Operativo:** Windows 10/11 x64 (PowerShell con codifica UTF-8).
* **Runtime Node.js:** Node.js $\ge 18.x$ e npm $\ge 9.x$.
* **Ambiente Python:** Python $\ge 3.10$ con modulo `venv`.
* **Runtime LLM Locale:** **Ollama** installato e attivo su `http://127.0.0.1:11434`.

---

### Profili Hardware Supportati (Presets P1 – P5)

| Profilo | Specifiche Hardware Minime | Suite Modelli Consigliata | Storage SSD |
| :--- | :--- | :--- | :--- |
| **P1: Ultra-Light (CPU-Only)** | CPU AVX2, 8–16 GB RAM, No GPU | `llama3.2:3b`, `qwen2.5-coder:1.5b`, `nomic-embed-text` | 15–20 GB |
| **P2: Entry-Level (Base GPU)** | GPU 6–8 GB VRAM, 16–32 GB RAM | `llama3.1:8b`, `qwen2.5-coder:7b`, `biomistral:latest`, `saul-instruct:7b`, `bge-m3` | 25–40 GB |
| **P3: Mid-Tier (Pro Workstation)** | GPU 12–16 GB VRAM, 32–64 GB RAM | `llama3.1:8b`, `qwen2.5-coder:14b`, `translategemma:7b`, `deepseek-r1:14b`, `flashrank` | 50–80 GB |
| **P4: High-End Pro (Heavy RAG)** | GPU 24–32 GB VRAM, 64 GB RAM | `qwen2.5:32b`, `qwen2.5-coder:32b`, `command-r:35b`, `deepseek-r1:32b` | 100–150 GB |
| **P5: Enterprise (Multi-GPU)** | GPU 48–96+ GB VRAM, 128+ GB RAM | `llama3.3:70b`, `deepseek-coder-v2:236b`, `meditron:70b`, `deepseek-r1:70b` | 200–450 GB |

---

## 2. Installazione Passo-Passo

### 1. Clonazione del Repository
```powershell
git clone https://github.com/dennidalpos/OnlyRagV2.git
cd OnlyRagV2
```

### 2. Installazione Dipendenze Node.js (Electron & React)
```powershell
npm install
```

### 3. Configurazione dell'Ambiente Virtuale Python (Sidecar)
```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r sidecar/requirements.txt
```

---

## 3. Variabili d'Ambiente e Configurazione Ollama

Per massimizzare l'efficienza della memoria ed eliminare la latenza di caricamento, si consiglia di configurare le variabili d'ambiente per il daemon Ollama:

```powershell
# Ascolto locale sicuro
$env:OLLAMA_HOST = "127.0.0.1:11434"

# Massimo numero di modelli contemporaneamente in VRAM (1 per evitare OOM)
$env:OLLAMA_MAX_LOADED_MODELS = "1"

# Concorrenza di richieste parallele
$env:OLLAMA_NUM_PARALLEL = "2"

# Ottimizzazione KV-Cache (risparmia fino al 50% di VRAM)
$env:OLLAMA_KV_CACHE_TYPE = "q8_0"

# Accelerazione inferenza
$env:OLLAMA_FLASH_ATTENTION = "1"

# Timeout di permanenza modello principale
$env:OLLAMA_KEEP_ALIVE = "30m"
```

---

## 4. Comandi di Sviluppo, Test e Build

Tutti i comandi devono essere eseguiti **rigorosamente in sequenza** su PowerShell.

### Avvio in Sviluppo
Avvia contemporaneamente il client Vite, il processo Electron e il sidecar FastAPI:
```powershell
npm run dev
```

### Controllo Tipi Statici (TypeScript)
```powershell
npm run typecheck
```

### Esecuzione Test Unitari Frontend ed Electron (Vitest)
```powershell
# Modalità rapida Fast (predefinita per agenti)
npm run test:fast

# Modalità ultra-veloce unit-only (solo dominio e applicazione)
npm run test:unit-only

# Modalità estesa completa
npm test
```

### Esecuzione Test Unitari Python Sidecar (Pytest)
```powershell
npm run test:sidecar
```

### Script di Automazione e Qualità (Fail-Fast)
```powershell
# Verifica qualità seriale (JSON, TypeScript, Python, Vitest)
.\scripts\lint_format.ps1 -Fast

# Verifica rapida solo moduli di dominio/applicazione
.\scripts\lint_format.ps1 -UnitOnly

# Pulizia sicura del workspace (rimozione cache temporanee e build artifacts)
npm run clean
npm run clean:full

# Collaudo live e health check sidecar FastAPI
.\scripts\test_sidecar_health.ps1 -Fast
```

### Build e Packaging di Produzione (NSIS Installer)
Compila il bundle client Vite, il bundle Electron main/preload e genera l'installer per Windows:
```powershell
npm run build
# oppure tramite script dedicato:
npm run package:win
```
L'eseguibile installer verrà generato in `dist/OnlyRag V2 Setup 1.0.0.exe`.

