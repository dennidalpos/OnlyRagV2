# Impostazioni nel desktop installato — 20 ottobre 2026

La prova conclusiva è ripetuta anche sul candidato **cpu-20261020-130728-0e85c502** dopo il fix di concorrenza dell’agente. Stessi controlli e readback completo passati; la ricevuta JSON conserva entrambi i lotti. Suite finale: 2.948 TypeScript/322 file, 622 Python/un symlink saltato, 64 mirati/5 file. L’installazione è un ambiente di prova temporaneo, rimosso dopo le verifiche senza cancellare profili o dati personali.

`SETTINGS-CLOSE-DURABILITY-01` concluso. Installer NSIS del candidato `cpu-20261020-114718-c7ebd99c` eseguito con successo in una nuova directory temporanea, dopo aver escluso installazioni e collegamenti OnlyRag preesistenti. Il profilo di prova è separato con il meccanismo E2E dell'app; nessun profilo personale è avviato.

Il runner esegue l'EXE installato tramite `ONLYRAG_QUALIFICATION_EXE`, conserva una ricevuta con `ONLYRAG_QUALIFICATION_EVIDENCE` e prova: debounce pendente alla chiusura, scrittura bloccata da una directory, chiusura rifiutata, ripristino dello storage, nuovo tentativo e chiusura, riapertura con lingua salvata, terminazione forzata del solo albero Electron posseduto, secondo riavvio e uguaglianza dell'intero oggetto impostazioni confermato. Il successo richiede il readback dopo entrambi i riavvii. Il runner ripulisce soltanto il proprio profilo temporaneo riuscito.

- `node scripts/e2e/settingsCloseDurability.mjs` con EXE installato: **passato**, incluso confronto completo dell'oggetto impostazioni dopo interruzione.
- Suite della modifica runtime precedente: **2.947 TypeScript / 322 file**, **622 Python / uno skip per symlink di directory non disponibile**; junction reali eseguite. Gate seriale con 15 casi Python critici, 31+17 cleanup, typecheck, docs e smoke passati.

Installer SHA-256: `3323260e985417415ce7bc041190079e76c75130c0f60d53859abe5291c57d7b`. [Ricevuta](./verification-installed-settings-2026-10-20.json). Evidenze complete in `C:/Users/Utente/AppData/Local/Temp/onlyrag-next-tasks-c9663097cc8849fea2f65670b710293e`, `installed-recovery/settings-close.json` e log `installed-settings-full-readback.log`.

Il profilo E2E disabilita l'avvio automatico Sidecar. Questa qualifica riguarda la persistenza delle impostazioni dell'EXE installato; non dichiara avvio automatico, qualità dei modelli o perdita di alimentazione, ancora nei task separati. Nessun commit, push o rilascio pubblico.
