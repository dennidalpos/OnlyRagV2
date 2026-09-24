# Diagnostica e auto-healing Agent

L'agente integra meccanismi deterministici di analisi diagnostica per guidare il modello verso correzioni immediate anziché tentativi casuali.

## Validazione sintattica pre-commit

Prima di persistere una modifica, il codice viene analizzato con il parser AST di TypeScript ([`sourceScriptKind.ts`](../electron/core/domain/agent/sourceScriptKind.ts)):

- JSX è accettato in `.js`, `.jsx` e `.tsx`, ma mai in file puramente `.ts`.
- Se il bundler del progetto (es. Vite 8/rolldown, esbuild) non ammette JSX nei file `.js`, la direttiva diagnostica impone l'uso di `move_file` verso `.jsx`, abilitando `move_file` nella policy del turno.
- Quando un file viene rinominato con successo via `move_file`, `GoalDecompositionPlanner.remapFilePath` aggiorna automaticamente i path delle milestone, i comandi di verifica e i token di evidenza nel piano salvato.

## Diagnostica fallimento test

[`testFailureDiagnostic.ts`](../electron/core/domain/agent/testFailureDiagnostic.ts) analizza l'output dei test (Jest, Vitest) ed emette direttive correttive precise:

- **Import errati**: corregge import relativi non risolti (`./App` al posto di `../App`).
- **Simboli globali non definiti**: inietta import mancanti per runner privi di globals (es. `import { describe, it, expect } from 'vitest'`).
- **Asserzioni isolate**: racchiude asserzioni fuori contesto all'interno di un blocco `it`.
- **Import componenti mancanti**: aggiunge import per `React`, `renderToString`, `render`.
- **Discrepanze di testo**: per asserzioni `toContain`/`toMatch` fallite, estrae il valore atteso ed effettivo. Se Vitest 0.x tronca il messaggio di Chai a 40 caratteri, la correzione ricava il testo letterale direttamente dal modulo JSX importato (`testedModuleText`).

## Diagnostica compilatore e build

[`compilerDiagnosticDirective.ts`](../electron/core/domain/agent/compilerDiagnosticDirective.ts) intercetta errori di compilazione e build senza codice TypeScript standard:

- **CSS & PostCSS**: `@import` CSS non risolti vengono sostituiti con il nome del pacchetto o rimossi; gli errori di sintassi PostCSS vengono segnalati direttamente.
- **Risoluzione moduli Vite**: import relativi non trovati vengono instradati per la creazione o rimossi se opzionali.
- **Script npm mancanti**: riscrive gli script che invocano binari non installati o ne richiede l'installazione mirata.

## Gestione dipendenze e package.json

- **Quesiti su versioni**: in modalità AUTO, richieste sulle versioni di dipendenze vengono risolte interrogando il registro npm e il manifest locale ([`versionQuestion.ts`](../electron/core/domain/agent/versionQuestion.ts)).
- **Pacchetti non installabili**: pacchetti inesistenti o rifiutati portano alla direttiva `dependencies_uninstallable`, che indica le righe di import esatte da rimuovere (`importDeclarationGate.ts`).
- **Errori ETARGET**: versioni non valide in `package.json` producono una direttiva unitaria di correzione del manifest (`processToolService.ts`, `dependencyVersionReality.ts`), evitando cicli di installazione singola che esaurirebbero il budget.
- **Coerenza skill e manifest**: [`skillVersionFit.ts`](../electron/core/domain/skills/skillVersionFit.ts) esclude dinamicamente le skill (es. `<pkg>-v<major>`) incompatibili con la versione dichiarata nel `package.json` attivo.
