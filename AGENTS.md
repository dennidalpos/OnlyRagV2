# Repository Instructions

`v1.6 · 2026-10-13` — Save as `AGENTS.md` in repository root. Fill project placeholders. Link to modular docs instead of duplicating them.

## 1. Stack & Environment
- Purpose: [Descrizione breve scopo e target]
- Mode: Greenfield (non in produzione salvo specifica contraria)
- Target: Web Responsive (Desktop 1080p, Tablet, Smartphone), [API/CLI]
- Stack & Tools: [Linguaggio, Framework, Package Manager, Test/Build Tools]
- Riferimenti:
  * Central Second Brain: `D:\GITHUB\SecondBrain` (tech radar, playbooks e gotchas cross-progetto)
  * Local Memory: `memory.md` (decisioni architetturali persistenti e gotchas di questo repo)
  * Active Tracker: `PROJECT_STATUS.json` (tracker task volatile attivo)
  * Documentation: `docs/` (modulare: `docs/architecture/`, `docs/api/`)

## 2. Directives & Quality
- Semplificazione Greenfield: Modifiche distruttive autorizzate per architettura minimale; no retrocompatibilità o shim legacy deprecati. Nessun refactor cosmetico fine a se stesso.
- Sicurezza (CRA/OWASP): Dipendenze minime con licenza pulita e zero vuln; validazione input ai confini; credenziali solo in `.env.example`.
- Invarianti: Responsive 1080p/mobile/tablet vincolante. Test mirati in sviluppo; `Full checks` obbligatori pre-commit/push.
- Git Gate: Commit e push su `main`/`master` autorizzati ESCLUSIVAMENTE con exit code 0 di `Full checks`.

## 3. Memory & Tracker Discipline
- `PROJECT_STATUS.json` (Volatile): Solo `important_notes`, `todo_autonomous`, `todo_user_required`. Zero storico: elimina subito i task completati. Ordinamento decrescente (P1, P2, P3).
- `memory.md` (Persistente Locale): Se assente in progetti estesi, crealo. Traccia pattern architetturali stabili, decisioni durature (perché X e non Y) e gotchas tecnici.
- `D:\GITHUB\SecondBrain` (Centrale): Distilla a fine sessione eventuali pattern o gotchas di valore generale riutilizzabili altrove.
```json
{
  "important_notes": ["Vincolo attivo"],
  "todo_autonomous": [{"id": "A1", "p": "P1", "task": "Azione atomica"}],
  "todo_user_required": [{"id": "U1", "p": "P1", "decision": "Decisione utente"}]
}
```

## 4. Commands
| Task | Command | Shell / Cwd | Note |
|---|---|---|---|
| Install | `npm install` | bash / root | Setup pulito dipendenze |
| Dev | `npm run dev` | bash / root | Server di sviluppo locale |
| Targeted checks | `npm test -- -t "target"` | bash / root | Test rapidi mirati all'ambito modificato |
| Full checks | `npm run test && npm run build` | bash / root | Gate pre-commit/push (test completi + build) |

## 5. Boundaries & Gotchas
- Documentazione: File modulari per ambito in `docs/`; vietati file monolitici.
- Tracker: MAI aggiungere campi "completed" o "history" a `PROJECT_STATUS.json`.
- Memoria: Mantieni sia `memory.md` che il Second Brain sintetici e privi di log operativi effimeri.
- State protetto: Non toccare configurazioni di ambienti esterni protetti o database persistenti senza autorizzazione.
