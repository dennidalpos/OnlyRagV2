# Matrice di Compatibilità Modelli Ollama & Calcolo Assegnazione Hardware

Questo documento costituisce la guida tecnica e la specifica analitica di riferimento per il calcolo del dimensionamento della memoria (VRAM e RAM), lo spazio su disco SSD e l'assegnazione automatica dei modelli locali compatibili con **Ollama** in **OnlyRag V2**.

---

## 1. Formule di Calcolo e Dimensionamento Risorse

### 1.1. Calcolo In-Memory Footprint dei Pesi del Modello ($W_{\text{mem}}$)
La quantità di memoria richiesta per caricare i pesi quantizzati in VRAM (o RAM in fallback CPU) è data da:

$$W_{\text{mem}} \text{ (GB)} \approx \left(\text{Parametri in Miliardi} \times \frac{\text{Bit di Quantizzazione}}{8}\right) \times 1.12$$

*Il coefficiente $1.12$ tiene conto dell'overhead di caricamento dei layer, dei buffer di input/output e della mappa tensoriale del runtime GGUF.*

---

### 1.2. Calcolo Memoria KV-Cache per la Context Window ($KV_{\text{mem}}$)
La memoria occupata dalla Attention Key-Value Cache scala linearmente con la context window (`num_ctx`) e dipende dal tipo di quantizzazione della cache:

$$KV_{\text{mem}} \text{ (GB)} = 2 \times N_{\text{layers}} \times N_{\text{heads}} \times d_{\text{head}} \times \text{num\_ctx} \times \text{BytesPerElem}$$

* **KV-Cache standard (FP16):** $\text{BytesPerElem} = 2$ bytes.
* **KV-Cache ottimizzata (`OLLAMA_KV_CACHE_TYPE=q8_0`):** $\text{BytesPerElem} = 1$ byte (**risparmio del 50% di VRAM**).

---

### 1.3. VRAM Totale Richiesta per Full GPU Offload ($VRAM_{\text{req}}$)
Per garantire che tutti i layer del modello risiedano nella memoria della scheda video senza memory paging:

$$VRAM_{\text{req}} = W_{\text{mem}} + KV_{\text{mem}} + VRAM_{\text{CUDA\_overhead}} \quad (\approx 0.8 - 1.2\text{ GB})$$

Se $\text{VRAM disponibile} < VRAM_{\text{req}}$, Ollama esegue un offload parziale su CPU/RAM (split layer `ngl`), riducendo la velocità di generazione.

---

### 1.4. Pre-Flight Storage Check per Download
Prima di eseguire il pull di uno o più modelli, il sistema valida che lo spazio libero su disco $S_{\text{free}}$ soddisfi la condizione:

$$S_{\text{free}} \ge \sum_{i=1}^{n} \text{Size}_{\text{model}_i} \times 1.25$$

---

## 2. Matrice dei Profili Hardware Host (P1 – P5)

| Profilo | Target Hardware Host | VRAM Dedicata | RAM di Sistema | Max Modelli Concorrenti in VRAM |
| :--- | :--- | :--- | :--- | :--- |
| **P1: Ultra-Light** | Solo CPU (AVX2), iGPU Intel/AMD | 0 GB (Integrata) | 8 – 16 GB DDR4/DDR5 | 1 (offload RAM completo) |
| **P2: Entry-Level** | GPU NVIDIA RTX 3060 / 4060, Apple M1/M2 16GB | 6 – 8 GB | 16 – 32 GB | 1 modello principale |
| **P3: Mid-Tier** | GPU NVIDIA RTX 4070 / 4080, Apple M2/M3 32GB | 12 – 16 GB | 32 – 64 GB | 1 principale + 1 secondario |
| **P4: High-End Pro**| GPU NVIDIA RTX 3090 / 4090 / 5090, Apple M3 64GB | 24 – 32 GB | 64 – 128 GB | 2 – 3 modelli residenti |
| **P5: Enterprise** | Multi-GPU (2x–4x RTX 4090, A100/H100), Apple 128GB+ | 48 – 96+ GB | 128 – 256 GB | 4+ modelli ad alta densità |

---

## 3. Catalogo e Matrice dei Modelli Compatibili Ollama

### 3.1. AI Coding Agent (Sviluppo Software & Terminal Tool Calling)

| Modello / Tag Ollama | Params | Quant | File Size (SSD) | VRAM Min (8k ctx) | VRAM Rec (16k-32k ctx) | Tier Complessità | Profilo HW |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `qwen2.5-coder:1.5b` | 1.5B | Q4_K_M | 0.98 GB | 1.8 GB | 2.5 GB | Fast Tier (🟢) | P1, P2, P3, P4, P5 |
| `llama3.2:1b` | 1.2B | Q4_K_M | 0.8 GB | 1.5 GB | 2.0 GB | Fast Tier (🟢) | P1, P2, P3, P4, P5 |
| `llama3.2:3b` | 3.2B | Q4_K_M | 2.0 GB | 3.2 GB | 4.2 GB | Fast / Standard Tier | P1, P2, P3, P4, P5 |
| `qwen2.5-coder:3b` | 3.1B | Q4_K_M | 1.9 GB | 3.0 GB | 4.0 GB | Fast / Standard Tier | P1, P2, P3, P4, P5 |
| `qwen2.5-coder:7b` | 7.6B | Q4_K_M | 4.7 GB | 6.2 GB | 7.8 GB | Standard Tier (🔵) | P2, P3, P4, P5 |
| `deepseek-coder:6.7b`| 6.7B | Q4_K_M | 4.1 GB | 5.8 GB | 7.2 GB | Standard Tier (🔵) | P2, P3, P4, P5 |
| `qwen2.5-coder:14b` | 14.7B| Q4_K_M | 9.0 GB | 11.5 GB | 14.0 GB | Standard / Deep Tier | P3, P4, P5 |
| `codestral:22b` | 22.2B| Q4_K_M | 13.5 GB | 16.0 GB | 20.0 GB | Deep Reasoning Tier | P3 (RAM), P4, P5 |
| `qwen2.5-coder:32b` | 32.5B| Q4_K_M | 19.8 GB | 22.5 GB | 26.0 GB | Deep Reasoning Tier | P4, P5 |
| `deepseek-coder-v2:16b`| 16B (MoE)| Q4_K_M | 8.9 GB | 10.5 GB | 13.0 GB | Deep Reasoning Tier | P3, P4, P5 |
| `deepseek-coder-v2:236b`| 236B (MoE)| Q4_K_M | 135 GB | 58 GB | 80 GB | Enterprise Deep Tier | P5 |

---

### 3.2. Reasoning & Thinking Models (Chain-of-Thought)

| Modello / Tag Ollama | Params | Quant | File Size (SSD) | VRAM Min (8k ctx) | VRAM Rec (16k-32k ctx) | Use Case | Profilo HW |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `deepseek-r1:1.5b` | 1.5B | Q4_K_M | 1.1 GB | 1.9 GB | 2.6 GB | Fast Reasoning & Logic | P1, P2, P3, P4, P5 |
| `deepseek-r1:7b` | 7.0B | Q4_K_M | 4.7 GB | 6.5 GB | 8.0 GB | CoT Problem Solving | P2, P3, P4, P5 |
| `deepseek-r1:8b` | 8.0B | Q4_K_M | 4.9 GB | 6.8 GB | 8.5 GB | Deep Reasoning Tier (🟣) | P2, P3, P4, P5 |
| `deepseek-r1:14b` | 14.7B| Q4_K_M | 9.0 GB | 11.8 GB | 14.5 GB | Deep Reasoning Tier (🟣) | P3, P4, P5 |
| `phi4:14b` | 14.0B| Q4_K_M | 9.1 GB | 11.5 GB | 14.0 GB | Compact Reasoning | P3, P4, P5 |
| `qwq:32b` | 32.5B| Q4_K_M | 19.8 GB | 22.8 GB | 26.5 GB | Logica & Math Pro | P4, P5 |
| `deepseek-r1:32b` | 32.5B| Q4_K_M | 19.9 GB | 23.0 GB | 27.0 GB | Deep Reasoning Pro | P4, P5 |
| `deepseek-r1:70b` | 70.6B| Q4_K_M | 43.0 GB | 48.0 GB | 56.0 GB | Heavy CoT & Proofs | P5 |

---

### 3.3. RAG Chat & Conversazione Generale

| Modello / Tag Ollama | Params | Quant | File Size (SSD) | VRAM Min (8k ctx) | VRAM Rec (16k-32k ctx) | Note di Dominio | Profilo HW |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `llama3.2:3b` | 3.2B | Q4_K_M | 2.0 GB | 3.2 GB | 4.2 GB | Chat leggera & sintesi | P1, P2, P3, P4, P5 |
| `llama3.1:8b` | 8.0B | Q4_K_M | 4.7 GB | 6.5 GB | 8.2 GB | Standard Gold RAG (128k ctx)| P2, P3, P4, P5 |
| `qwen2.5:7b` | 7.6B | Q4_K_M | 4.7 GB | 6.3 GB | 8.0 GB | Multilingua conversazionale | P2, P3, P4, P5 |
| `gemma2:2b` | 2.6B | Q4_K_M | 1.6 GB | 2.8 GB | 3.5 GB | Ultra-low memory chat | P1, P2, P3, P4, P5 |
| `gemma2:9b` | 9.2B | Q4_K_M | 5.5 GB | 7.5 GB | 9.5 GB | High fidelity reasoning | P2, P3, P4, P5 |
| `mistral:7b` | 7.2B | Q4_K_M | 4.4 GB | 6.0 GB | 7.6 GB | Robust instruction follower | P2, P3, P4, P5 |
| `qwen2.5:14b` | 14.7B| Q4_K_M | 9.0 GB | 11.5 GB | 14.0 GB | Knowledge Base Enterprise | P3, P4, P5 |
| `qwen2.5:32b` | 32.5B| Q4_K_M | 19.8 GB | 22.5 GB | 26.0 GB | RAG ad alta fedeltà | P4, P5 |
| `llama3.3:70b` | 70.6B| Q4_K_M | 43.0 GB | 48.0 GB | 56.0 GB | State-of-the-art Local LLM | P5 |

---

### 3.4. Traduzione Linguistica & Localization

| Modello / Tag Ollama | Params | Quant | File Size (SSD) | VRAM Min (4k ctx) | VRAM Rec (8k-16k ctx) | Specializzazione | Profilo HW |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `translategemma:2b` | 2.6B | Q4_K_M | 1.6 GB | 2.6 GB | 3.5 GB | Traduzione rapida paragrafi | P1, P2, P3, P4, P5 |
| `gemma2:2b` | 2.6B | Q4_K_M | 1.6 GB | 2.6 GB | 3.5 GB | Traduzione bilingue base | P1, P2, P3, P4, P5 |
| `translategemma:7b` | 7.6B | Q4_K_M | 4.8 GB | 6.2 GB | 7.8 GB | Traduzione documenti/tabelle| P2, P3, P4, P5 |
| `qwen2.5:7b` | 7.6B | Q4_K_M | 4.7 GB | 6.2 GB | 7.8 GB | Traduzione multilingue (29L) | P2, P3, P4, P5 |
| `aya-expanse:8b` | 8.0B | Q4_K_M | 5.1 GB | 6.8 GB | 8.5 GB | Allineamento cross-lingua | P2, P3, P4, P5 |
| `translategemma:12b`| 12.0B| Q4_K_M | 7.8 GB | 9.8 GB | 12.0 GB | Traduzione specialistica | P3, P4, P5 |
| `translategemma:27b`| 27.2B| Q4_K_M | 16.5 GB | 19.5 GB | 23.0 GB | Massima fedeltà e stile | P4, P5 |
| `aya-expanse:32b` | 32.5B| Q4_K_M | 20.0 GB | 23.0 GB | 27.0 GB | Corpus letterari complessi | P4, P5 |

---

### 3.5. Settori Verticali Specialistici (Medical & Legal)

| Modello / Tag Ollama | Dominio | Params | Quant | File Size | VRAM Min | VRAM Rec | Note Cliniche / Giuridiche | Profilo HW |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `biomistral:latest` | Medico | 7.2B | Q4_K_M | 4.4 GB | 6.0 GB | 7.5 GB | PubMed & Farmacologia | P2, P3, P4, P5 |
| `meditron:7b` | Medico | 7.0B | Q4_K_M | 4.3 GB | 5.9 GB | 7.4 GB | Linee guida cliniche | P2, P3, P4, P5 |
| `meditron:70b` | Medico | 70.6B| Q4_K_M | 43.0 GB | 48.0 GB | 55.0 GB | Consulto nosologico profondo | P5 |
| `saul-instruct:7b` | Legale | 7.0B | Q4_K_M | 4.3 GB | 5.9 GB | 7.4 GB | Contratti & Giurisprudenza UE | P2, P3, P4, P5 |
| `command-r:35b` | Legale | 35.0B| Q4_K_M | 21.0 GB | 24.0 GB | 28.0 GB | RAG Grounding & Compliance | P4, P5 |
| `command-r-plus:104b`| Legale | 104B | Q3_K_M | 54.0 GB | 58.0 GB | 68.0 GB | Audit corporate su larga scala | P5 |

---

### 3.6. Multimodal Vision & OCR Documentale

| Modello / Tag Ollama | Params | Quant | File Size (SSD) | VRAM Min | VRAM Rec | Funzionalità | Profilo HW |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `moondream:latest` | 1.8B | Q4_K_M | 1.1 GB | 2.2 GB | 2.8 GB | Captioning & OCR rapido | P1, P2, P3, P4, P5 |
| `llava:7b` | 7.0B | Q4_K_M | 4.5 GB | 6.5 GB | 8.0 GB | Vision & OCR standard | P2, P3, P4, P5 |
| `minicpm-v:8b` | 8.0B | Q4_K_M | 5.5 GB | 7.5 GB | 9.0 GB | OCR fine per tabelle dense | P2, P3, P4, P5 |
| `llama3.2-vision:11b`| 11.0B| Q4_K_M | 7.9 GB | 10.0 GB | 12.5 GB | OCR diagrammi & formule | P3, P4, P5 |
| `qwen2.5-vl:7b` | 7.6B | Q4_K_M | 5.2 GB | 7.2 GB | 8.8 GB | Layout analysis & scanned PDF| P2, P3, P4, P5 |
| `llama3.2-vision:90b`| 90.0B| Q4_K_M | 55.0 GB | 58.0 GB | 68.0 GB | Analisi tecnica ad alta risoluzione | P5 |

---

### 3.7. Vector Embedding & Re-Ranking

| Modello / Tag Ollama | Dimensione Vettoriale | Max Ctx Tokens | File Size | VRAM / RAM | Velocità | Use Case |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `nomic-embed-text:latest` | 768 dim | 8.192 tokens | 274 MB | < 0.5 GB | Ultra-Fast (>1500 chunk/s) | Default Ingestion P1–P3 |
| `all-minilm:latest` | 384 dim | 512 tokens | 120 MB | < 0.3 GB | Ultra-Fast (>2000 chunk/s) | Test & sistemi minimali |
| `bge-m3:latest` | 1024 dim | 8.192 tokens | 1.1 GB | 1.4 GB | Fast (>800 chunk/s) | Hybrid RAG Gold Standard |
| `mxbai-embed-large:latest`| 1024 dim | 512 tokens | 670 MB | 0.9 GB | Fast (>900 chunk/s) | Dense Retrieval |
| `snowflake-arctic-embed:latest`| 1024 dim | 8.192 tokens | 670 MB | 0.9 GB | Fast (>1000 chunk/s) | Enterprise Knowledge Base |
| `flashrank` (In-process CPU) | Cross-Encoder | 512 tokens | 34 MB | < 0.1 GB | Real-Time (<30ms top-15) | Re-Ranking post-RRF $k=60$ |

---

## 4. Algoritmo di Assegnazione Automatica nel Setup Wizard

Il motore [`hardwareRecommendationEngine.ts`](file:///d:/GITHUB/OnlyRagV2/src/services/hardwareRecommendationEngine.ts) esegue il calcolo con le seguenti priorità:

1. **Rilevamento VRAM Effettiva:**
   - $\text{VRAM} \ge 24\text{ GB} \implies \text{Preset P4}$ (Full offload modelli 14B–32B, standard coding `qwen2.5-coder:14b` o `32b`).
   - $\text{VRAM} \ge 12\text{ GB} \implies \text{Preset P3}$ (Standard coding `qwen2.5-coder:7b` / `14b`, RAG `llama3.1:8b`, vision `llama3.2-vision:11b`).
   - $\text{VRAM} \ge 6\text{ GB} \implies \text{Preset P2}$ (Standard coding `qwen2.5-coder:7b`, fast `qwen2.5-coder:1.5b`, RAG `llama3.1:8b`, vision `llava:7b`).
   - $\text{VRAM} < 6\text{ GB}$ o solo CPU $\implies \text{Preset P1}$ (Fast coding `qwen2.5-coder:1.5b`, chat `llama3.2:3b`, embedding `nomic-embed-text`).

2. **Politica di Model Pinning & Lifecycle:**
   - Il modello del modulo correntemente aperto dall'utente viene mantenuto caldo in memoria (`keep_alive: 15m` o `30m`).
   - I task di supporto secondari (es. traduzione veloce o OCR di un singolo foglio) vengono eseguiti con `keep_alive: 0m` per evizione immediata senza intaccare la VRAM del modello primario.
   - Il `num_ctx` per ciascuna chiamata viene calcolato dinamicamente da [`contextWindowCalculator.ts`](file:///d:/GITHUB/OnlyRagV2/electron/core/domain/agent/contextWindowCalculator.ts) ($2048, 4096, 8192, 16384, 32768$) garantendo il minor consumo possibile di KV-Cache.
