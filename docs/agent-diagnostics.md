# Diagnostica del Coding Agent

Il runtime riduce gli output lunghi, classifica fallimenti di parser, test, compilatore e build, poi propone una correzione circoscritta. Il consiglio resta un dato del tool; l'ordine del turno spetta all'arbitro ([`agent-guards.md`](./agent-guards.md#consigli-e-ordini)). Le diagnostiche non certificano il task: serve una verifica effettiva sul progetto.

## Validazione sintattica pre-commit

[`sourceScriptKind.ts`](../electron/core/domain/agent/sourceScriptKind.ts) sceglie il parser per l'estensione. La sintassi non valida viene rifiutata prima della scrittura; una rinomina riuscita aggiorna i riferimenti del piano.

## Diagnostica fallimento test

[`testFailureDiagnostic.ts`](../electron/core/domain/agent/testFailureDiagnostic.ts) distingue import assenti, simboli non definiti, asserzioni e DOM richiesto dal runner. Suggerisce la modifica del file responsabile; non trasforma una stringa di errore in prova che il fix funzioni.

## Diagnostica compilatore e build

[`compilerDiagnosticDirective.ts`](../electron/core/domain/agent/compilerDiagnosticDirective.ts) riconosce errori CSS/PostCSS, import non risolti ed export mancanti. [`diagnosticOutputReducer.ts`](../electron/core/domain/agent/diagnosticOutputReducer.ts) conserva righe di errore e percorsi utili nella traiettoria.

## Gestione dipendenze e package.json

Manifest e lockfile sono verificati prima delle installazioni. Il manager dichiarato e il lockfile univoco governano i comandi Node; tool mancanti o prove incomplete restano `unverifiable`, senza acquisizione automatica. La [qualifica nativa](./verification-native-projects-2026-10-19.md) copre sei ecosistemi nei fixture dichiarati; le [regressioni del verificatore](./verification-project-regressions-2026-10-20.md) verificano root, discovery Python e distinzione fra successo strutturale e test effettivamente eseguiti. Restano nel [`tracker`](../PROJECT_STATUS.json) le qualifiche installate e con modelli reali.
