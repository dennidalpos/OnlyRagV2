# CREDITS — OnlyRagV2

Componenti di terze parti usati da OnlyRagV2 (licenza del progetto: MIT, vedi [LICENSE](LICENSE)). Elenco generato il 2026-11-02 da `package-lock.json` (npm), dai requisiti Python di `sidecar/` (licenze lette da PyPI) e dai manifest; le versioni effettive sono quelle dei lockfile.

## Dipendenze npm

Il lockfile contiene 816 pacchetti, 257 di produzione. Licenze dei pacchetti di produzione:

| Licenza | Pacchetti |
| --- | --- |
| `MIT` | 225 |
| `ISC` | 14 |
| `BSD-2-Clause` | 12 |
| `Apache-2.0` | 2 |
| `BSD-3-Clause` | 2 |
| `Python-2.0` | 1 |
| `UNKNOWN` | 1 |

Dipendenze dirette: braces (copia locale in `vendor/`), cheerio, depcheck, diff, js-yaml, mustache, p-queue, playwright, react-markdown, remark-gfm, semver, strip-ansi, turndown, zod. Il campo licenza di `callsite` 1.0.0 manca nel lockfile (pacchetto MIT dell'autore originale: da confermare nel registro npm). Le licenze MPL-2.0 (copyleft a livello di file) non richiedono di rilasciare il codice del progetto.

## Dipendenze Python (sidecar)

| Pacchetto | Versione minima | Licenza |
| --- | --- | --- |
| fastapi | 0.110.0 | MIT |
| uvicorn | 0.28.0 | BSD-3-Clause |
| lancedb | 0.6.0 | Apache Software License |
| pymupdf | 1.24.0 | Dual Licensed - GNU AFFERO GPL 3.0 or Ar… |
| pydantic | 2.6.0 | MIT |
| python-multipart | 0.0.9 | Apache-2.0 |
| httpx | 0.27.0 | BSD License |
| numpy | 1.26.0 | BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0 |
| pandas | 2.0.0 | BSD-3-Clause |
| pyarrow | 25.0.1 | Apache-2.0 |
| openpyxl | 3.1.5 | MIT License |
| xlrd | 2.0.2 | BSD License |
| python-docx | 1.1.0 | MIT License |
| pillow | 13.0.0 | MIT-CMU |
| puremagic | 1.30 | MIT |
| rapidocr | 3.9.0 | Apache-2.0 |
| wordfreq | 3.1.0 | Apache Software License |
| symspellpy | 6.7.7 | MIT License |
| langdetect | 1.0.9 | Apache Software License |
| tabulate | 0.9.0 | MIT |
| opencv-python | 4.8.0 | Apache Software License |
| ftfy | 6.2.0 | Apache-2.0 |
| chevron | 0.14.0 | MIT License |
| onnxruntime | 1.29.0 | MIT License |
| pyinstaller | 6.22.2 | GNU General Public License v2 (GPLv2) |

Ambiente di esecuzione: `onnxruntime-gpu` (MIT) con le librerie NVIDIA CUDA/cuDNN, distribuite con la propria licenza NVIDIA e non coperte da questo elenco.

## Compatibilità con la licenza MIT del progetto

- **PyMuPDF (AGPL-3.0 o licenza commerciale Artifex)**: incompatibile con la distribuzione di un'applicazione sotto sola licenza MIT. Chi distribuisce i binari che includono PyMuPDF deve rispettare l'AGPL-3.0 (codice sorgente corrispondente, anche per l'uso in rete) oppure acquisire la licenza commerciale. Decisione del proprietario (2026-11-01, registrata in SecondBrain): il progetto resta MIT e la distribuzione dei binari con PyMuPDF segue l'AGPL-3.0.
- **PyInstaller (GPL-2.0 con eccezione per i bootloader)**: gli eseguibili generati non ereditano la GPL; PyInstaller non fa parte del prodotto distribuito.
- **MPL-2.0 (24 pacchetti npm)**: obblighi limitati ai file modificati dei singoli pacchetti.
- Le licenze permissive (MIT, ISC, BSD, Apache-2.0, 0BSD, BlueOak, MIT-CMU) richiedono la conservazione di avvisi di copyright e testi di licenza.

Verifica non svolta: dipendenze transitive Python (non c'è un lockfile Python), licenze dei modelli e dei dataset di `wordfreq` e OCR, componenti nativi nei pacchetti di release.