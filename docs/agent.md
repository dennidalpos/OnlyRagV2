# Coding Agent

Il Coding Agent fornisce un ambiente di sviluppo controllato e guidato da modelli LLM locali (Ollama). L'architettura separa rigorosamente la proposta di azioni (modello) dalla validazione, esecuzione e verifica (Main Electron).

```text
complexity check -> [interview -> plan] -> collect_context -> propose_action
                                                     -> apply_action -> verify -> outcome
```

## Ambiti documentati

La documentazione dell'agente è suddivisa per ambito:

| Documento | Contenuto |
| --- | --- |
| [`agent-runtime.md`](./agent-runtime.md) | Ciclo di vita, orchestrazione, modalità (Ask, Guided, Auto), pianificazione JSON, confinamento workspace, token budget e thinking. |
| [`agent-guards.md`](./agent-guards.md) | Politica di progresso (`agentProgressPolicy`), tabella `PROGRESS_BUDGET`, loop detector, compare-and-swap di versione e sicurezza comandi. |
| [`agent-diagnostics.md`](./agent-diagnostics.md) | Validazione AST pre-commit, auto-healing test (Vitest/Jest), diagnostica build/compiler e gestione dipendenze `package.json`. |

## Principi chiave

- **Nessuna mutazione cieca**: ogni modifica su file esistenti applica compare-and-swap sull'hash della versione letta.
- **Isolamento completo**: le sessioni di progetto operano in worktree/copie temporanee separate; la pubblicazione nel workspace sorgente è esplicita e verificata contro il baseline.
- **Decisioni deterministiche**: le condizioni di loop, stallo e fallimento build sono governate da budget deterministici e direttive mirate, non da tentativi ripetuti del modello.
- **Verifica comportamentale**: la chiusura con stato `verified` richiede test effettivi che passano, non semplici asserzioni del modello o conformità sintattica.
