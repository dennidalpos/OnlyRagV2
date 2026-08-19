# Implementation Plan — OnlyRag V2

Piano operativo dettagliato per i task attivi in `PROJECT_STATUS.json`. Questo file vive fuori da `/docs/` (che AGENTS.md riserva alla documentazione canonica di architettura/moduli/API/setup) perché è materiale di lavoro transitorio: va aggiornato o eliminato quando i task sono completi, non mantenuto come riferimento permanente.

Contesto: nasce da un audit critico del piano di evoluzione originale (agent loop, traduzione documentale, matrice hardware). Due dei tre task originariamente previsti per la matrice hardware (modello Legal nel catalogo, badge impatto VRAM nel Wizard) sono risultati **già implementati** durante la ricerca per questo piano — vedi nota in fondo. Resta un solo task "vicino" eseguibile ora (Task 3) più un task ad alta complessità rimandato a sessione dedicata (Task 4).

---

## Task 3 — Consolidamento file `*Types.ts` a consumatore singolo (agentOrchestrator*)

### Obiettivo
Ridurre la frammentazione dei 24 file `agentOrchestrator*.ts` in `electron/core/application/`. **Solo leggibilità/navigazione — zero modifiche di logica o comportamento.** Non è un redesign del loop (che segue già il flusso Model Response → Tool Parser → Journal Snapshot → Execution → Verification descritto in `docs/architecture.md` §5).

### Scope verificato (grep repo-wide, non solo nella cartella)
Esistono 8 coppie `X.ts` / `XTypes.ts`. Di queste, solo **5** hanno la `XTypes.ts` importata da un unico file — quelle sono le uniche sicure da accorpare senza toccare altri moduli. Le altre 3 sono contratti condivisi tra più file e **devono restare separate**:

| Types file | Importato da | Azione |
|---|---|---|
| `agentOrchestratorResponseInterpreterTypes.ts` | 4 file (Bootstrap​Types, FinishAndLoopGuards, ResponseInterpreter, SessionState​Types) | **Non toccare** |
| `agentOrchestratorToolResultTypes.ts` | 4 file (BootstrapTypes, CircuitBreakerAndVerification, SessionStateTypes, ToolResultProcessor) | **Non toccare** |
| `agentOrchestratorTurnDispatchTypes.ts` | 2 file, incluso un modulo "pari" (PromptAssembly.ts, non l'owner) | **Non toccare** |

Accorpare una di queste in uno dei suoi consumatori creerebbe un accoppiamento direzionale scorretto (un modulo importerebbe tipi da un altro modulo pari invece che da un contratto neutro condiviso).

### File da accorpare (5 — sicuri, un solo consumer ciascuno)

| # | Types file (da eliminare dopo il merge) | Consumer unico (destinazione) | Righe types |
|---|---|---|---|
| 1 | `agentOrchestratorBootstrapTypes.ts` | `agentOrchestratorBootstrap.ts` | 74 |
| 2 | `agentOrchestratorSessionContextTypes.ts` | `agentOrchestratorSessionContext.ts` | 30 |
| 3 | `agentOrchestratorSessionPersistenceTypes.ts` | `agentOrchestratorSessionPersistence.ts` | 29 |
| 4 | `agentOrchestratorSessionStateTypes.ts` | `agentOrchestratorSessionState.ts` | 46 |
| 5 | `agentOrchestratorSessionWatchdogTypes.ts` | `agentOrchestratorSessionWatchdog.ts` | 24 |

Risultato atteso: 24 file → **19 file**.

### Procedura (identica per ciascuna delle 5 coppie — eseguire una coppia alla volta, seriale, come da AGENTS.md §3)

Tutti e 5 gli `<Impl>.ts` seguono lo stesso pattern verificato in testa al file:
```typescript
import type { X, Y } from './<Impl>Types'
export type { X, Y } from './<Impl>Types'   // re-export pubblico
```

Per ogni coppia:

1. Aprire `<Impl>Types.ts`. Copiare tutte le sue `export interface` / `export type` (incluso `EmitLog` se presente — vedi nota sotto).
2. Incollarle in `<Impl>.ts`, subito dopo il blocco import esistente.
3. In `<Impl>.ts`, rimuovere le due righe `import type {...} from './<Impl>Types'` e `export type {...} from './<Impl>Types'` — i tipi ora sono locali e già esportati (copiati come `export interface`/`export type`).
4. Se `<Impl>Types.ts` importava a sua volta tipi concreti da altri moduli (es. `AgentTaskPayload`, `AppSettings`, `TransactionalExecutionGuard`, ...) non già importati in `<Impl>.ts`, unire quegli import al blocco import esistente di `<Impl>.ts`, senza duplicati.
5. Eliminare fisicamente `<Impl>Types.ts`.
6. Verifica di sicurezza: `grep -rl "<Impl>Types" --include="*.ts" --include="*.tsx" .` dalla root del repo deve dare **zero risultati**.
7. `npm run typecheck` — deve passare pulito prima di passare alla coppia successiva.

### Nota: duplicazione di `EmitLog`

Il type `EmitLog` (`(type: 'info' | 'tool_call' | 'terminal' | 'approval_request', message: string, detail?: string) => void`) è ridefinito identico in almeno 4 dei file coinvolti in questo task. **Non unificarlo in questo task** — richiederebbe toccare file oltre ai 5 elencati sopra e andrebbe oltre lo scope "solo leggibilità" concordato. Se in futuro si vuole eliminare la duplicazione, va trattato come task a parte esplicitamente richiesto.

### Definition of Done — COMPLETATO
- [x] 24 → 19 file in `electron/core/application/agentOrchestrator*` (5 `*Types.ts` accorpati ed eliminati: Bootstrap, SessionContext, SessionPersistence, SessionState, SessionWatchdog)
- [x] `npm run typecheck` pulito
- [x] `npm run test:fast` pulito — 79 file di test, 550 test, tutti passati
- [x] Zero righe di logica applicativa modificate — solo spostamento di dichiarazioni di tipo
- [x] Voce rimossa da `PROJECT_STATUS.json`

### Comandi di verifica (eseguire in sequenza, mai in parallelo — AGENTS.md §3)
```powershell
npm run typecheck
npm run test:fast
```

---

## Task 4 — Traduzione in-place PDF/DOCX

### Perché è un task a parte (contesto, non più un blocco totale)
- Tocca contemporaneamente sidecar Python (PyMuPDF, python-docx), frontend, e LanceDB (re-indicizzazione atomica)
- Rischio concreto di compliance se la redaction non cancella realmente il testo originale sotto il testo tradotto (vale soprattutto per i domini Medical/Legal che il progetto vuole abilitare) — rilevante per le Fasi 2+, non per la Fase 1
- **Nota di correzione rispetto alla stesura precedente di questo piano**: esiste già una feature "Translation" in [`TranslationView.tsx`](src/components/translation/TranslationView.tsx) / [`useTranslation.ts`](src/hooks/useTranslation.ts), ma è un pipeline diverso e non riusabile per questo task — traduce il markdown estratto a chunk e poi lo ricompila in un **file nuovo** da zero via `export_markdown_to_file` ([`exporter.py`](sidecar/domain/exporter.py), font builtin PyMuPDF `helv`/`hebo`, nessuna preservazione di layout/immagini/stile originali nonostante il docstring dica il contrario). Zero riuso possibile: Task 4 richiede di mutare i byte del file originale mantenendo stile/tabelle/immagini intatti, non di rigenerarlo da markdown.

### Sotto-fasi (ordine invariato dalla stesura precedente)
1. **DOCX-only**: sostituzione run testuali via `python-docx`, preservando stile/paragrafi/tabelle — **dettagliato sotto, pronto per l'esecuzione**
2. **PDF fine-mode senza auto-fit**: redaction reale + reinserimento testo nel bbox originale con font fisso, clipping se il testo tradotto eccede lo spazio — richiede ancora una sessione di scoping dedicata
3. **Auto-fit progressivo** del font size per gestire l'espansione/contrazione del testo tradotto rispetto all'originale — non pronto
4. **Copertura CJK** e font TrueType universali — non pronto

### Le 4 domande aperte della stesura precedente, risolte per la Fase 1
- **Contratto endpoint**: risolto sotto.
- **Strategia di redaction PyMuPDF**: non si applica alla Fase 1 (DOCX). La riassegnazione di `run.text` in python-docx è cancellazione reale (il testo originale non sopravvive nell'XML del run), non un overlay visivo — nessuna redaction necessaria. Resta un problema aperto solo per la Fase 2 (PDF), da risolvere quando quella sessione verrà aperta; ipotesi di lavoro corrente: `Page.add_redact_annot()` + `apply_redactions()` è l'API standard PyMuPDF per cancellazione reale del contenuto (non solo visiva), da verificare empiricamente con un test di integrazione che ispezioni lo stream PDF grezzo post-redazione prima di considerarla adottata.
- **Font TTF universali**: non si applica alla Fase 1. `python-docx` riusa il font già presente nel run — nessun font nuovo da imbarcare finché non si traduce verso lingue CJK (Fase 4).
- **Debounce/queue salvataggio atomico**: non si applica alla Fase 1, che è una singola richiesta/risposta atomica innescata da un'azione utente esplicita, non un autosave continuo. Rilevante solo se una Fase 2/3 introduce editing live per-pagina sincronizzato con Monaco.

---

### Fase 1 — DOCX-only in-place translation (pronta per l'esecuzione)

#### Endpoint
`POST /documents/{doc_id}/translate-inplace`

Nuovo schema in `sidecar/schemas.py`:
```python
class TranslateInplaceRequest(BaseModel):
    source_lang: str
    target_lang: str
```
Risposta: riusa `IngestResponse` (stesso contratto di `PUT /documents/{doc_id}`), perché l'operazione termina con lo stesso ciclo re-chunk/re-embed/replace-doc-record già usato da `update_and_reindex_document`.

Guardrail espliciti (mappati sui pattern di errore già in uso in `main.py`, `ValueError` → 404/400):
- `doc.file_type != "docx"` → 400 ("In-place translation supported for DOCX only in this phase")
- `file_path` mancante o non più presente su disco → 404

#### Pipeline (nuovo modulo `sidecar/domain/translator.py`, parallelo a `exporter.py`/`ingestion.py` per separation of concerns)
1. `validate_doc_id(doc_id)`, lookup del record in `DOCS_TABLE_NAME` (stesso pattern di `update_and_reindex_document`/`render_document_page_preview`).
2. Guardrail sopra.
3. `doc = docx.Document(file_path)`.
4. Raccogliere tutti i run non vuoti, in ordine: `doc.paragraphs` + paragrafi di ogni cella di ogni tabella (stessa copertura di `extract_document_markdown` per DOCX in [`ingestion.py`](sidecar/domain/ingestion.py):381-423).
5. Batch di traduzione: raggruppare run consecutivi in batch (~2500 char), uniti con un delimitatore univoco (es. `\n<<<RUN_SEP>>>\n`); prompt che impone esplicitamente di restituire lo stesso numero di segmenti nello stesso ordine. Chiamata via `httpx_client.post(f"{ollama_url}/api/generate", ...)`, stesso pattern già usato da `run_vision_ocr` in [`ocr.py`](sidecar/infrastructure/ocr.py) — il sidecar chiama Ollama direttamente, nessun routing attraverso il renderer.
6. **Controllo di correttezza obbligatorio**: se il numero di segmenti restituiti non combacia con l'input, fallback a traduzione run-per-run per quel batch (più lento ma sicuro) invece di disallineare silenziosamente le traduzioni sui run sbagliati.
7. Riassegnare `run.text` per ciascun run nell'ordine originale. Stile/font/bold/corsivo/tabelle restano quelli del run — non vengono toccati.
8. `doc.save(file_path)` — sovrascrive il file originale in place.
9. Re-estrarre il markdown dal file appena tradotto (`extract_document_markdown`) e passarlo direttamente a `update_and_reindex_document(doc_id, new_markdown)` — già fa esattamente cancellazione vecchi chunk, re-chunking, re-embedding e sostituzione doc record. Nessun helper condiviso da estrarre: è già una funzione pubblica riusabile così com'è, chiamata diretta senza duplicare nulla.
10. Ritorna l'`IngestResponse` di `update_and_reindex_document`.

#### Frontend
- Nuovo metodo `apiService.translateDocumentInplace(docId, sourceLang, targetLang)` accanto al metodo esistente per `PUT /documents/{doc_id}`.
- Punto di ingresso UI: azione "Traduci in-place" visibile solo per documenti DOCX (nascosta/disabilitata per altri tipi in questa fase). **Richiede un dialog di conferma esplicito** — l'operazione sovrascrive irreversibilmente il file originale, nessun backup automatico. Non procedere a costruire questa UI senza che l'utente veda e accetti quella conferma a runtime.

#### Test (nuovo `sidecar/tests/test_translator.py`)
- Round-trip del delimitatore batch (allineamento segmenti in→out)
- Fallback per mismatch nel conteggio dei segmenti
- Happy path documento intero con risposta Ollama mockata (`monkeypatch` su `httpx_client.post`)
- Verifica che stile/bold/tabelle sopravvivano al round-trip (assert su `run.font.bold` ecc. dopo il save)

Nota: `scripts/test_sidecar_health.ps1` punta esplicitamente a `sidecar\tests\test_sidecar.py`; va esteso a tutta la cartella `sidecar\tests\` (o al nuovo file) perché il nuovo test venga effettivamente eseguito.

#### Definition of Done — Fase 1 — COMPLETATO
- [x] Endpoint `POST /documents/{doc_id}/translate-inplace` implementato e testato ([main.py](sidecar/main.py), [schemas.py](sidecar/schemas.py))
- [x] `sidecar/domain/translator.py` con pipeline di cui sopra (batch + fallback per-run su mismatch segmenti, riuso diretto di `update_and_reindex_document` per re-indicizzazione, zero duplicazione)
- [x] Catena IPC Electron completa: `sidecarAppService.ts` → `sidecarIpc.ts` → `preload.ts` → `apiService.ts` → `useIngestion.ts`
- [x] Azione UI con dialog di conferma esplicito (`TranslateInplaceModal.tsx`), visibile solo per DOCX in `DocumentListTable.tsx`
- [x] `sidecar/tests/test_translator.py` verde: batch/collect runs, round-trip felice, fallback su mismatch segmenti, end-to-end via TestClient (ingest reale → translate-inplace → verifica file su disco + markdown reindicizzato), guardrail doc-non-trovato e file-non-DOCX
- [x] `.venv\Scripts\pytest.exe sidecar\tests -q` pulito (51 test, 1 fallimento flaky pre-esistente e scorrelato — `test_history_index_search_and_project_filter`, passa isolato — segnalato a parte, non bloccante per questo task)
- [x] `npm run typecheck` pulito
- [x] `npm run test:fast` pulito — 79 file, 550 test invariati

Nota: `scripts/test_sidecar_health.ps1` aggiornato per puntare a tutta la cartella `sidecar\tests\` invece del solo `test_sidecar.py`, altrimenti il nuovo file di test non sarebbe mai stato eseguito da quello script.

### Fasi 2-4
Restano non pronte per l'esecuzione. Aprire una sessione di scoping dedicata quando la Fase 1 sarà in produzione, riutilizzando le ipotesi di lavoro su redaction/font annotate sopra come punto di partenza, non come decisioni già prese.

---

## Nota: correzioni emerse durante la stesura di questo piano

Durante la ricerca per questo piano è emerso che **due dei task originariamente previsti per la "matrice hardware" erano già completamente implementati**, cosa non individuata nel primo giro di audit:

- **Modello Legal nel catalogo**: `MEDICAL_TIER_CATALOG` e `LEGAL_TIER_CATALOG` esistono già in [`hardwareModelCatalog.ts`](src/services/hardwareModelCatalog.ts) (righe 836–919), coperti su tutti e 5 i tier hardware, con fallback agnostico `llama3.2:3b` su legacy/entry/midrange e modelli specializzati su highend/extreme. Un test (`hardwareRecommendationEngine.test.ts`) verifica già che `legalTierModels.length > 0`.
- **Badge impatto VRAM**: [`ModelOptionCard.tsx`](src/components/wizard/ModelOptionCard.tsx) mostra già i badge 🟡 Tight VRAM / 🔴 Exceeds VRAM (🟢 implicito quando assente), alimentati da `assessModelHardwareCompatibility` e già cablati in tutti gli step del Setup Wizard, incluso il tab dedicato Legal & Compliance in [`WizardStepGeneralLlms.tsx`](src/components/wizard/WizardStepGeneralLlms.tsx).

La documentazione in `docs/` è stata corretta di conseguenza. Nessuna azione richiesta su questi due punti.
