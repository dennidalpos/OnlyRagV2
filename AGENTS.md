# Istruzioni di Repository

`v1.8 · 2026-10-15` — Salva come `AGENTS.md` nella radice del repository (o come `CLAUDE.md` se si usa Claude Code). I dettagli operativi restano nella documentazione modulare.

## 1. Stack e Ambiente
- **Scopo**: Applicazione desktop locale per Windows per ingestione documenti, ricerca RAG offline, traduzione e workflow con Coding Agent.
- **Modalità**: Greenfield (semplificazione aggressiva per architettura minimale; eliminazione shim temporanei e dead code)
- **Target Applicativo**: Desktop Windows con Electron e interfaccia responsive (Desktop 1080p, Tablet, Smartphone), Sidecar REST locale e CLI di manutenzione.
- **Stack & Toolchain**: TypeScript, React, Vite, Electron, Python 3.13 / FastAPI, LanceDB, npm, Vitest, pytest e PowerShell (`pwsh`).
- **Ambiente di Esecuzione**: Windows, shell PowerShell (`pwsh`). Richiede `.gitattributes` configurato nella radice con `* text=auto eol=lf`.

## 2. Disciplina della Memoria e Riferimenti
Instrada la conoscenza nel posto corretto senza duplicazioni:

| Archivio | Posizione | Contenuto | Ciclo di Vita |
|---|---|---|---|
| **Istruzioni Repo** | `AGENTS.md` | Comandi di build/test, vincoli attivi, architettura core | Stabile |
| **Memoria Locale** | `memory.md` | Decisioni durevoli (perché X e non Y), pattern locali, gotchas | Persistente nel repo |
| **Tracker Attivo** | `PROJECT_STATUS.json` | Task correnti ordinati per priorità (P1 prima di P2); zero storico | Volatile (elimina i chiusi) |
| **Documentazione** | `docs/` | Guide modulari (`docs/architecture/`, `docs/api/`, `docs/operations.md`) | Versionata |
| **Dossier Repo SecondBrain** | `D:\GITHUB\SecondBrain\repos\OnlyRagV2` | Scheda context.md, backup direttive e memoria storica consolidata | Centralizzato |
| **Second Brain Globale** | `D:\GITHUB\SecondBrain` | Pattern tecnologici (tech_radar), playbooks e gotchas cross-progetto | Curato (solo su conferma) |

### Struttura `PROJECT_STATUS.json`
```json
{
  "important_notes": ["Vincolo attivo per la sessione"],
  "todo_autonomous": [
    {"id": "A1", "p": "P1", "task": "Azione atomica eseguibile dall'agente", "verify": "comando test o criterio di verifica"}
  ],
  "todo_user_required": [
    {"id": "U1", "p": "P1", "decision": "Decisione architetturale o di business richiesta all'utente"}
  ]
}
```
*Regola*: MAI aggiungere campi `completed` o `history` a `PROJECT_STATUS.json`; eliminare immediatamente i task completati.

## 3. Direttive di Sicurezza e Qualità
- **Sicurezza (OWASP Top 10:2025 / ASVS 5.0 / CRA)**:
  * Validazione rigorosa degli input ai confini dell'applicazione (schema runtime e Zod per contratti IPC).
  * **Segreti**: Nessuna credenziale o token nel codice. `.env.example` contiene **esclusivamente placeholder fittizi**. Credenziali reali solo in `.env` ignorato da Git.
  * Dipendenze verificate con zero vulnerabilità note critiche/alte senza mitigazione documentata.
- **Invarianti di Progetto**:
  * Responsive design 1080p, tablet e smartphone vincolante.
  * Isolamento Renderer / Main process tramite Electron Preload e IPC tipizzato (`shared/ipc/ipcContract.ts`).
  * LanceDB locale e runtime Ollama locale per elaborazione documenti in totale privacy offline.
  * Test mirati (`Targeted checks`) durante lo sviluppo di ciascun componente.
  * Verifica completa (`Full checks`) obbligatoria prima di ogni commit.

## 4. Comandi di Progetto
> Esegui sempre da PowerShell (`pwsh`) nella radice del repository.

| Task | Comando | Shell / Cwd | Scopo & Note |
|---|---|---|---|
| **Install** | `npm install` | pwsh / root | Setup dipendenze frontend |
| **Setup Dev** | `npm run setup:dev` | pwsh / root | Configurazione ambiente completo (Node + venv Python) |
| **Dev** | `npm run dev` | pwsh / root | Server di sviluppo locale con hot reload |
| **Targeted checks** | `npx vitest run <percorso>` | pwsh / root | Test rapidi mirati all'ambito modificato |
| **Full checks** | `npm run test && pytest` | pwsh / root | **Gate obbligatorio pre-commit** (test completi frontend e backend) |

## 5. Disciplina Git & Confini Operativi
- **Nessun Branch**: Lavoro diretto sul ramo principale (`main`/`master`), salvo diversa indicazione esplicita dell'utente.
- **Commit Gate**: Commit consentito solo dopo il passaggio con exit code 0 di `Full checks` e verifica che il diff non contenga file di debug o segreti.
- **Push Gate**: **Push su remoto eseguito SOLO previa richiesta o conferma esplicita dell'utente**.
- **Confini Protetti**: Non toccare senza autorizzazione database persistenti attivi o ambienti esterni protetti.
