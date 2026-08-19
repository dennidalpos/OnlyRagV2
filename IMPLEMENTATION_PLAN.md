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

## Task 4 (SESSIONE SEPARATA) — Traduzione in-place PDF/DOCX: solo inquadramento, non istruzioni operative

Questo task **non è pronto per l'esecuzione**. Quanto segue è lo scope concordato in fase di audit, non un piano dettagliato — richiede una sessione di pianificazione dedicata prima di scrivere codice.

### Perché è separato dagli altri task
- Zero codice esistente da estendere (nessun riscontro per `translate-inplace`, redaction, font auto-fit in tutto il repo — verificato via grep)
- Tocca contemporaneamente sidecar Python (PyMuPDF, python-docx), frontend (sync Editor Monaco/Preview per-pagina), e LanceDB (re-indicizzazione atomica)
- Rischio concreto di compliance se la redaction non cancella realmente il testo originale sotto il testo tradotto (vale soprattutto per i domini Medical/Legal che il progetto vuole abilitare)

### Sotto-fasi concordate (l'ordine, non il dettaglio implementativo)
1. **DOCX-only**: sostituzione run testuali via `python-docx`, preservando stile/paragrafi/tabelle
2. **PDF fine-mode senza auto-fit**: redaction reale + reinserimento testo nel bbox originale con font fisso, clipping se il testo tradotto eccede lo spazio
3. **Auto-fit progressivo** del font size per gestire l'espansione/contrazione del testo tradotto rispetto all'originale
4. **Copertura CJK** e font TrueType universali

### Domande da sciogliere all'apertura della sessione dedicata (non ora)
- Contratto esatto di `POST /documents/translate-inplace` (request/response schema)
- Strategia di redaction PyMuPDF (verificare se `Page.add_redact_annot()` + `apply_redactions()` — l'API standard PyMuPDF per cancellazione reale del contenuto, non solo visiva — copre il caso d'uso)
- Font TTF universali da imbarcare nell'app: peso pacchetto (famiglie con buona copertura CJK come Noto Sans CJK pesano decine di MB) — imbarcarli o scaricarli on-demand?
- Debounce/queue per il salvataggio atomico multi-pagina, per evitare re-embedding ripetuti su modifiche ravvicinate dell'utente

---

## Nota: correzioni emerse durante la stesura di questo piano

Durante la ricerca per questo piano è emerso che **due dei task originariamente previsti per la "matrice hardware" erano già completamente implementati**, cosa non individuata nel primo giro di audit:

- **Modello Legal nel catalogo**: `MEDICAL_TIER_CATALOG` e `LEGAL_TIER_CATALOG` esistono già in [`hardwareModelCatalog.ts`](src/services/hardwareModelCatalog.ts) (righe 836–919), coperti su tutti e 5 i tier hardware, con fallback agnostico `llama3.2:3b` su legacy/entry/midrange e modelli specializzati su highend/extreme. Un test (`hardwareRecommendationEngine.test.ts`) verifica già che `legalTierModels.length > 0`.
- **Badge impatto VRAM**: [`ModelOptionCard.tsx`](src/components/wizard/ModelOptionCard.tsx) mostra già i badge 🟡 Tight VRAM / 🔴 Exceeds VRAM (🟢 implicito quando assente), alimentati da `assessModelHardwareCompatibility` e già cablati in tutti gli step del Setup Wizard, incluso il tab dedicato Legal & Compliance in [`WizardStepGeneralLlms.tsx`](src/components/wizard/WizardStepGeneralLlms.tsx).

La documentazione in `docs/` è stata corretta di conseguenza. Nessuna azione richiesta su questi due punti.
