# Fixture CI: scadenze worker e retention — 20 ottobre 2026

I task `CI-DEPENDENCY-SCAN-WORKER-DEADLINE-01` e `CI-CAPABILITY-AUDIT-RETENTION-TIMEOUT-01` **restano aperti**. Le correzioni seguenti riguardano le fixture locali; il runtime worker e il writer durevole non cambiano. La futura revisione richiede ancora pubblicazione autorizzata ed esito remoto esatto, oltre alla diagnosi delle fasi non presenti nei log storici.

## Worker nativo

Il [run b470387](https://github.com/dennidalpos/OnlyRagV2/actions/runs/39458594764) fallisce nel caso coda/scadenza con `2000 ms`, mentre la richiesta accodata dichiara `30 ms`. Il log originale non distingue se è scaduto il worker attivo o il successivo retry, né riporta avvio/terminazione per fase: non attribuiamo una causa certa al runner.

La fixture confondeva il tempo di avvio nativo e la pianificazione del runner con la scadenza logica verificata. Ora quel solo caso usa Date/timer controllati, mantenendo worker realmente avviato in loop, cancellazione reale, attesa della terminazione e retry nativo. A 29 ms il worker attivo non deve essere terminato; a 30 ms la richiesta accodata scade senza dispatch; la cancellazione termina il solo worker posseduto prima del retry. Un ulteriore caso avanza entrambe le scadenze e verifica il timeout attivo, rifiuto della coda e nuova ammissione. Il test distinto di responsività mantiene timer reali. Le future eccezioni includono nome della richiesta, durata reale e presenza del marker nativo.

## Retention

Il [run f1dd1b7](https://github.com/dennidalpos/OnlyRagV2/actions/runs/39414623075) supera 30 secondi dopo 1.005 append seriali, ciascuno con lettura, parsing, serializzazione e riscrittura durevole del prefisso crescente. La baseline locale sotto coverage passa ma impiega **6.810 ms**: non è una riproduzione del timeout remoto.

La fixture ora prepara 995 record persistiti validi e attraversa la soglia con dieci append reali. A ogni passo confronta tutte le identità e il loro ordine, poi rilegge da un repository nuovo le ultime 1.000 identità e la redazione. I casi separati di entry invalide, redazione e append concorrenti restano attivi. Nessun mock del writer, bypass del flush, timeout aumentato o modifica del limite runtime. Prima misura della nuova fixture: **140 ms** sotto coverage; la suite finale aggiunge anche il confronto completo a ogni append. Questo rimuove il setup ridondante, senza sostenere di aver misurato il costo I/O dell'esatto vecchio runner.

## Stato remoto

Il [run e95e915](https://github.com/dennidalpos/OnlyRagV2/actions/runs/39469529994) è `completed/success` al nuovo readback. È la consegna precedente a queste modifiche: non certifica la nuova fixture e non diagnostica le due intermittenze storiche. I log falliti originali sono conservati separatamente. Nessun commit o push in questo seguito locale.

Riferimenti: [timer controllati Vitest](https://vitest.dev/api/vi.html#vi-usefaketimers), [worker e terminazione Node 24.20.0](https://github.com/nodejs/node/blob/v24.20.0/doc/api/worker_threads.md). API verificate anche con Vitest 4.1.11 installato dal lockfile.
