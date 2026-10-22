# Passaggio di sessione: lotto tracker, pulizia, documentazione e guida Mermaid — 22 ottobre 2026

Il proprietario richiede salvataggio del lavoro, aggiornamento del tracker, commit sul branch principale e push per cambio sessione. Verificati repository pubblico `dennidalpos/OnlyRagV2`, remoto `origin`, default e branch corrente `master`, base `9a49b30beab5dd082988f7fffa1ec53a133872b1`, allineata 0/0 dopo `git fetch origin`.

## Lavoro salvato

1. **Lotto del tracker del 22 ottobre** ([`verification-tracker-lot-2026-10-22.md`](./verification-tracker-lot-2026-10-22.md)):
   - Conclusi e rimossi dal tracker `TEST-SIDECAR-DETERMINISTIC-WRAPPER-01` (P2) e `INGESTION-OCR-PROVIDER-LABEL-01` (P3).
   - [`scripts/test_sidecar_health.ps1`](../scripts/test_sidecar_health.ps1) esegue deterministicamente `python -m pytest -q` senza ramo live sulla porta 8000 (9 test in [`scripts/sidecarTestWrapper.test.mts`](../scripts/sidecarTestWrapper.test.mts)); aggiornati [`package.json`](../package.json), [`skills/code-quality-and-linting/SKILL.md`](../skills/code-quality-and-linting/SKILL.md) e [`skills/fastapi-pydantic-v2/SKILL.md`](../skills/fastapi-pydantic-v2/SKILL.md).
   - [`src/lib/ocrProvider.ts`](../src/lib/ocrProvider.ts), [`src/hooks/useIngestion.ts`](../src/hooks/useIngestion.ts), [`src/components/ingestion/OcrEngineBadge.tsx`](../src/components/ingestion/OcrEngineBadge.tsx) e dizionari [`it.ts`](../src/i18n/locales/it.ts) / [`en.ts`](../src/i18n/locales/en.ts) derivano l'etichetta OCR dal provider effettivo riportato dal Sidecar `online` (25 test in [`src/hooks/useIngestionOcrProvider.test.tsx`](../src/hooks/useIngestionOcrProvider.test.tsx)).
2. **Pulizia profonda del repository (P10)**:
   - Estesa [`scripts/cleanup_policy.ps1`](../scripts/cleanup_policy.ps1) (`Get-RepoCleanupRoots`) alle directory `__pycache__` esplicite del repository (32 test isolati in [`scripts/test_cleanup_policy.ps1`](../scripts/test_cleanup_policy.ps1)) e rimossi dal checkout i 9 output/cache rigenerabili più la directory vuota orfana `.github/workflows`.
   - Rimossi 11 simboli/import di dead code privi di chiamanti in [`agentToolExecutorService.ts`](../electron/core/application/agentToolExecutorService.ts), [`skillAppService.ts`](../electron/core/application/skillAppService.ts), [`sessionDebtTracker.ts`](../electron/core/domain/agent/sessionDebtTracker.ts), [`documentIoRepository.ts`](../electron/core/infrastructure/filesystem/documentIoRepository.ts), [`sidecarHttpClient.ts`](../electron/core/infrastructure/http/sidecarHttpClient.ts), [`codingAgentLogger.ts`](../electron/core/infrastructure/logging/codingAgentLogger.ts), [`agentLiveHarness.ts`](../scripts/live/agentLiveHarness.ts), [`exporter.py`](../sidecar/domain/exporter.py), [`ingestion.py`](../sidecar/domain/ingestion.py), [`word_segmenter.py`](../sidecar/domain/word_segmenter.py) e [`test_word_segmenter.py`](../sidecar/tests/test_word_segmenter.py).
3. **Riallineamento della documentazione (P11) e guida visiva in Mermaid (P13)**:
   - Riallineate le guide correnti ([`README.md`](./README.md), [`verification-current.md`](./verification-current.md), [`operations.md`](./operations.md), [`ingestion.md`](./ingestion.md), [`libraries.md`](./libraries.md), [`history.md`](./history.md), [`documentation-audit-2026-10-21.md`](./documentation-audit-2026-10-21.md)).
   - Aggiornata [`guida-utente.md`](./guida-utente.md) con **26 diagrammi Mermaid distinti** (`flowchart TD`, sezioni `00`–`25`) nel linguaggio dell'utente finale italiano, affiancati ai 26 SVG offline in [`assets/flussi-utente/`](./assets/flussi-utente/) (con 9 descrizioni `<desc>` arricchite) e ai percorsi testuali equivalenti.
   - Esteso [`scripts/validate_documentation.mjs`](../scripts/validate_documentation.mjs) (8 test in [`scripts/validate_documentation.test.mts`](../scripts/validate_documentation.test.mts)) per validare sintassi, rami decisionali, lunghezza etichette e raggiungibilità dei diagrammi Mermaid.

Le note «nessun commit o push» nei rapporti datati della sessione descrivono le fasi di lavoro precedenti a questa richiesta esplicita di consegna.

## Tracker e ripresa

[`PROJECT_STATUS.json`](../PROJECT_STATUS.json) conserva schema e storico delle note importanti. Restano aperte **quattro attività autonome (tre P2 e una P3) e zero attività con decisione utente**:

| Attività autonoma | Priorità | Condizione di ripresa |
| --- | --- | --- |
| `DEPENDENCY-BRACES-UPSTREAM-01` | P2 | Valutare una release upstream $> 3.0.3$ quando pubblicata su npm (al 2026-10-22 `latest` è ancora `3.0.3` del 2024-09-18), eseguendo i gate parser/AST, `npm ci`, YAML/proxy e ASAR. |
| `DEVSERVER-LOOPBACK-PROBE-STABILITY-01` | P2 | Mantenere invariate le guardie loopback/PID finché il rifiuto storico intermittente non viene riprodotto e attribuito con evidenze socket/listener/PID (100 nuovi casi nativi passati il 22 ottobre senza riproduzione). |
| `TEST-PNPM-OFFLINE-PREPARATION-01` | P2 | Rendere deterministico il ramo `pnpm` di `persistentPowerShellSession.test.ts` quando l'installazione `pnpm` dell'host (WinGet `12.14.0`) non ha una cache locale pre-popolata per risolvere `packageManager` in modalità `--offline`. |
| `OCR-RUNTIME-EFFECTIVE-PROVIDER-01` | P3 | Riportare in `get_ocr_runtime_info` e `/health` il provider RapidOCR effettivamente inizializzato anche quando `_get_rapidocr_engine` ripiega su CPU dopo un errore di inizializzazione CUDA. |

## Gate e verifiche della consegna

- **Suite e controlli eseguiti**:
  - `npm run typecheck`, `npm run quality:static` (891 file, 107 handler IPC), `npm run audit:deadcode` (`knip` normale e `--production`), `npm run audit:cycles` (`dpdm` 475 file, 0 cicli), `npm run assets:check`, `npm run docs:check` (122 file Markdown e 26 diagrammi Mermaid), `npm run format:check` e validità XML dei 26 SVG → **PASS**.
  - Test Vitest mirati sui file toccati nella sessione (243 test su 11 file, inclusi `sidecarTestWrapper.test.mts`, `useIngestionOcrProvider.test.tsx`, `validate_documentation.test.mts` e le suite dei moduli ripuliti) e `npm run test:skills` (24 test su 5 file) → **PASS**.
  - Suite TypeScript completa (`npx vitest run` nel lotto del 22 ottobre): **3.035 passati su 3.036** in 330 file; l'unico fallimento è il caso ambientale `pnpm --offline` tracciato in `TEST-PNPM-OFFLINE-PREPARATION-01`.
  - Suite Python completa tramite [`scripts/test_sidecar_health.ps1`](../scripts/test_sidecar_health.ps1) con overlay `pytest==9.1.1` isolato in `%TEMP%` (`PYTHONDONTWRITEBYTECODE=1`): **688 passati**, 0 skip; 94 test `pytest` mirati sui moduli Python ripuliti e gate [`scripts/check_python_critical.py`](../scripts/check_python_critical.py) (**15 casi su 8 controlli obbligatori senza skip**) → **PASS**.
  - Script PowerShell di pulizia: 32 casi in [`scripts/test_cleanup_policy.ps1`](../scripts/test_cleanup_policy.ps1) e 17 casi in [`scripts/test_log_cleanup.ps1`](../scripts/test_log_cleanup.ps1) → **PASS**.
- **Protezione dati e backup**:
  - I 66 file di `userdata_dev` sono invariati per insieme e digest SHA-256.
  - Backup pre-commit e ricevute salvati fuori dal checkout in `%TEMP%/onlyrag-session-publication-20261022` (oltre al backup dei file rigenerabili rimossi in `%TEMP%/onlyrag-p10-repo-cleanup-backup-20261022`).

## Conservazione e limiti

Nel `.venv` del checkout manca ancora `pytest` (richiede `npm run setup:dev` o un overlay isolato); la suite completa `npm run test` mantiene il singolo fallimento ambientale `TEST-PNPM-OFFLINE-PREPARATION-01`. Nessuna chiamata a modelli generativi reali, build/installazione di nuovi installer, migrazione di profili personali, smaltimento di prove storiche o commit/push del repository SecondBrain.
