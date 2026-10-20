# Riconciliazione degli effetti interrotti — 20 ottobre 2026

Dopo il fix della race passano **2.948 test TypeScript/322 file**, **64 mirati/5 file** e le tre interruzioni native ripetute; l’ASAR del candidato conclusivo contiene il medesimo Main verificato. La prova è ripetuta anche avviando l’EXE installato, mantenendo generazione simulata e comandi figli reali. Le ricevute iniziali rimangono datate.

`AGENT-INFLIGHT-EFFECT-RECONCILIATION-01` è concluso nel perimetro dichiarato. La decisione del proprietario è implementata: **Ispeziona prove**, poi consenso esplicito e **Abbandona esecuzione**. L'azione dall'esito ignoto non viene ripetuta né annullata. Riprendi continua a rifiutarla.

Il Main lega l'ispezione all'identità completa e al digest SHA-256 di richiesta accettata e stato conservato. L'abbandono rilegge le prove, richiede lo stesso digest e una fase `apply_action` non terminale, esclude esecuzioni attive e serializza le ammissioni concorrenti. Una scrittura atomica con readback conserva richiesta, stato, digest e data nel ledger `agent-task-recovery.json`, stato `abandoned`. Il checkpoint e i file del workspace restano immutati. I successori possono essere ripresi esplicitamente; l'identità abbandonata rimane rifiutata dopo riavvio. Una scrittura fallita mantiene il task pendente.

Le prove sono testo semplice, anche con markup ostile. Il Renderer non sceglie percorsi: i nuovi canali IPC validano identità, digest e mittente. Riferimenti compatibili con Electron **43.7.4**: [sicurezza e mittente](https://github.com/electron/electron/blob/v43.7.4/docs/tutorial/security.md), [IPC e bridge](https://github.com/electron/electron/blob/v43.7.4/docs/tutorial/ipc.md).

## Qualifica

Tre punti fissati prima dell'esecuzione: ingresso senza effetto, effetto parziale `started`, effetto concluso `started/completed` prima del ritorno del comando. Il figlio scrive marcatori in workspace temporanei posseduti e resta aperto; il runner termina con `taskkill /T /F` soltanto il proprio Electron. Dopo riavvio verifica fase persistita, rifiuto del replay e dell'abbandono senza ispezione, ispezione, abbandono e secondo riavvio. Stato e marcatori rimangono identici, senza nuove richieste di generazione. Il caso dopo risultato confermato rimane nel runner di recupero esistente.

- `npx vitest run electron/core/application/agentTaskRecovery.test.ts electron/core/presentation/agentIpc.test.ts src/components/coding/AgentTaskRecoveryBanner.test.tsx src/hooks/codingAgent/useCodingAgentExecution.test.tsx --reporter=dot`: **46 passati / 4 file**. Include prove mutate, identità estranee, scrittura rifiutata, doppio abbandono, esecuzione attiva, conservazione, consenso UI e markup non interpretato.
- `npm run build`: superato.
- `node scripts/e2e/agentReliability.mjs --reconciliation-only`: **3/3 interruzioni native passate**, Main/Preload e figli reali; generazione simulata su loopback.

Ricevuta e hash: [JSON](./verification-inflight-reconciliation-2026-10-20.json). Log e dati completi: `C:/Users/Utente/AppData/Local/Temp/onlyrag-next-tasks-c9663097cc8849fea2f65670b710293e`, sottodirectory `native-reconciliation`. Tentativi falliti conservati separatamente.

Non sono certificati effetti di rete arbitrari, exactly-once o perdita di alimentazione. L'abbandono conserva ciò che è noto senza dichiarare riuscito l'effetto ignoto. Desktop installato e modelli reali mantengono qualifiche separate, ora autorizzate su dati e ambienti di prova isolati. Nessuna migrazione personale o pubblicazione è inclusa.

## Revisione finale della concorrenza

La nuova ammissione nella stessa conversazione resta bloccata anche mentre l’abbandono è in scrittura: il task pendente non viene escluso per il solo fatto di essere in una ammissione attiva. Una regressione sospende l’archiviazione, verifica il rifiuto della nuova run e la ammette soltanto dopo il readback. Il candidato iniziale precede questa correzione; viene conservato come intermedio e rigenerato, senza attribuirgli retroattivamente il fix.
