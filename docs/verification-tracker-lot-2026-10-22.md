# Lotto del tracker: wrapper Sidecar ed etichetta OCR — 22 ottobre 2026

Esecuzione locale del piano approvato dal proprietario, senza commit o push. Base `master` 9a49b30 allineata a `origin/master`, working tree pulito all'avvio. Nessun modello reale, servizio personale, installer o migrazione.

## Esito per attività

| ID | Esito | Evidenza |
| --- | --- | --- |
| `TEST-SIDECAR-DETERMINISTIC-WRAPPER-01` (P2) | **Concluso** | Wrapper senza ramo live; suite reale e fixture controllate. |
| `INGESTION-OCR-PROVIDER-LABEL-01` (P3) | **Concluso** | Etichetta derivata dal provider del Sidecar online; regressioni hook/badge. |
| `DEPENDENCY-BRACES-UPSTREAM-01` (P2) | Aperto, bloccato da evento esterno | `npm view braces version` → `3.0.3` (registro modificato il 2024-09-18): nessun candidato che sostituisca `3.0.4+onlyrag.1`. |
| `DEVSERVER-LOOPBACK-PROBE-STABILITY-01` (P2) | Aperto, causa non stabilita | 20 cicli, **100 casi nativi passati**, nessuna riproduzione; guardie invariate. |

## Wrapper Sidecar

[test_sidecar_health.ps1](../scripts/test_sidecar_health.ps1) esegue sempre `python -m pytest -q` dalla radice (suite di `pytest.ini`) e propaga il codice di uscita. Rimossi la sonda della porta 8000, le richieste health/export/search senza token e i parametri `-Fast/-Full/-FullOutput`; `-PythonExe` sceglie l'interprete (predefinito `.venv\Scripts\python.exe`). Interprete o pytest mancanti producono exit 2 con messaggio esplicito. Il ramo live è stato rimosso, non spostato: senza launch-token export e search sarebbero rifiutati da un Sidecar reale, e gli smoke facoltativi passano da `test:models:smoke`.

Durante la prova reale Windows PowerShell 5.1 trasformava lo stderr nativo rediretto (`No module named pytest`) in un errore terminante con `ErrorActionPreference = Stop`, restituendo exit 1 al posto del messaggio previsto. Le chiamate native ora sono giudicate solo da `$LASTEXITCODE`; la fixture finta scrive su stderr come un interprete reale.

[sidecarTestWrapper.test.mts](../scripts/sidecarTestWrapper.test.mts), 9 casi, esegue il vero script con un interprete finto:

- listener loopback posseduto su `127.0.0.1:8000` (porta libera all'avvio, confermato da `Get-NetTCPConnection`): suite invocata, exit 0 e 1 propagati, **zero connessioni**; un caso di controllo dimostra che il listener conta una connessione reale;
- senza listener posseduto: exit 0, 1 e 5 propagati;
- pytest mancante ed interprete mancante: exit 2, messaggio, nessuna invocazione della suite;
- controllo statico: nessun cmdlet o client di rete, nessun `127.0.0.1`/`:8000`.

Prove negative: lo script di HEAD fallisce 8 casi su 9; la variante con `ErrorActionPreference = Stop` fallisce il caso pytest mancante.

Esecuzioni reali:

| Comando | Esito |
| --- | --- |
| `npm run test:sidecar` con `.venv` del checkout (senza pytest) | exit 2, `pytest non disponibile … Eseguire npm run setup:dev.` |
| `test_sidecar_health.ps1` con overlay pytest isolato | **688 passati**, nessuno skip, 182 s, exit 0 |

L'overlay è `pip install --target %TEMP%\…\pytest-overlay pytest==9.1.1 -c sidecar/constraints.txt` (pytest, pluggy, iniconfig, packaging 26.3 già uguale al venv, pygments, colorama), usato tramite `PYTHONPATH` con `PYTHONDONTWRITEBYTECODE=1` e `-p no:cacheprovider`. Il `.venv` del checkout non è stato modificato. Nel checkout il caso symlink di directory non viene saltato, a differenza delle copie isolate precedenti (687 + 1 skip). Il JUnit richiesto tramite `PYTEST_ADDOPTS` non è stato prodotto: il conteggio deriva dal riepilogo pytest nel log.

## Etichetta del provider OCR

[ocrProvider.ts](../src/lib/ocrProvider.ts) restituisce `cuda` o `cpu` soltanto per un Sidecar `online` che riporta esattamente `CUDAExecutionProvider` o `CPUExecutionProvider`; avvio, offline, campo assente o valore diverso restano `unknown`. [useIngestion.ts](../src/hooks/useIngestion.ts) usa il risultato nel ramo RapidOCR nativo di PDF e immagini: `RapidOCR (CUDA|CPU|provider in verifica)`, localizzato IT/EN. Vision OCR, fallback, pipeline, modello ed errori operativi restano invariati. [OcrEngineBadge.tsx](../src/components/ingestion/OcrEngineBadge.tsx) usa la stessa regola: un provider CUDA residuo con Sidecar offline non mostra più `GPU ON`.

[useIngestionOcrProvider.test.tsx](../src/hooks/useIngestionOcrProvider.test.tsx), 25 casi: resolver (7), progresso PNG/JPG/BMP/WEBP/PDF con CUDA, CPU, CPU su host GPU, checking, offline residuo, assente, non riconosciuto e senza diagnostica (11), italiano, Vision e fallback, errore esplicito conservato, badge (4). Per CPU e stati sconosciuti nessun testo `CUDA` in tecnologia, step, pipeline o modello. Contro `useIngestion.ts` e badge di HEAD falliscono 13 casi (etichetta e offline residuo); Vision ed errore passano anche su HEAD, a conferma del comportamento preservato.

Limite: il Sidecar riporta il provider **disponibile** in onnxruntime, non quello del motore inizializzato. Se l'inizializzazione CUDA fallisce, RapidOCR ripiega su CPU mentre `/health` continua a indicare CUDA. Residuo tracciato separatamente come `OCR-RUNTIME-EFFECTIVE-PROVIDER-01`, fuori da questo lotto.

## Controlli complessivi

| Controllo | Esito |
| --- | --- |
| `npm run typecheck`, `npm run quality:static` (891 file), `npm run audit:deadcode`, `npm run audit:cycles` | passati |
| Suite TypeScript completa `npx vitest run` | 3035 passati, **1 fallito** su 3036 / 330 file |
| Gate Python critico (`scripts/check_python_critical.py` con venv temporaneo `.pth` → `.venv` + overlay) | 15 passati in 8 controlli, nessuno skip |
| `npm run docs:check` (121 Markdown), `npm run format:check`, `npm run test:skills` (24 test / 5 file) | passati |

L'unico fallimento TypeScript, `persistentPowerShellSession.test.ts` › *runs available native npm/pnpm scripts…*, non riguarda file modificati e si riproduce isolato. Causa ambientale verificata fuori dall'app: l'host ha pnpm 12.14.0 (WinGet) senza cache `%LOCALAPPDATA%\pnpm-cache\v12`; `pnpm install --offline` con `packageManager: pnpm@12.14.0` fallisce con `ERR_PNPM_BAD_CONFIG_DEP` perché pnpm non risolve offline sé stesso come dipendenza di configurazione. Il test ordinario dipende quindi dallo stato dell'host: residuo `TEST-PNPM-OFFLINE-PREPARATION-01`, non corretto in questo lotto. Il gate completo pre-commit non è quindi interamente verde.

Diagnostica dev-server: Node v24.20.0, Windows 10.0.26300; 20 cicli × cinque casi (Vite, self-connect forzato, singola readiness, rifiuto wildcard IPv4/IPv6), 370 s, 624 file di evidenza in `C:/Users/Utente/OnlyRag-Live/managed-dev-diagnostics-cafe09db-d8ad-446e-b5a8-3e86135c769c` (`report.json`). La campagna è stata eseguita senza altri carichi concorrenti.

I 66 file di `userdata_dev` sono stati confrontati per SHA-256 prima e dopo il lavoro. Nessun nuovo file ignorato nel checkout. L'ambiente Python di verifica usato il 21 ottobre (`OnlyRag-Live/critical-audit-20261021/source/.venv`) non è più utilizzabile: i suoi collegamenti puntano a `%TEMP%\onlyrag-publication-98bd…`, che contiene solo directory vuote.
