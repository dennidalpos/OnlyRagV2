# Ripresa del tracker: CI e diagnosi dev-server — 20 ottobre 2026

Lotto locale: `CI-DEPENDENCY-SCAN-WORKER-DEADLINE-01`, `CI-CAPABILITY-AUDIT-RETENTION-TIMEOUT-01` e `DEVSERVER-LOOPBACK-PROBE-STABILITY-01`. **Nessun task rimosso: 34 aperti, 15 autonomi / 19 owner-required, 4 P1 / 27 P2 / 3 P3.** Restano invariati schema, priorità, dipendenze e criteri originali. Le attività che richiedono modelli, installazioni, migrazioni o decisioni del proprietario non entrano automaticamente nel lotto.

## Esito remoto dell'esatto sorgente

Il [run 39483553222](https://github.com/dennidalpos/OnlyRagV2/actions/runs/39483553222), SHA `e48c468bb6559cc0a57ff3b40ef0635fc301333b`, è `completed/success`, terminato il **20 ottobre 2026 alle 21:39:44 CEST**. Coverage: **2.953 test / 323 file**. Sidecar: **667 passati**, nessuno skip riportato. Passano anche Monaco nativo, writer, build e recovery previsti dal workflow.

Questo completa il readback remoto delle fixture pubblicate. Non ricostruisce la fase esatta del timeout worker storico né il costo I/O del vecchio runner retention: i due task CI restano **parziali** per quelle diagnosi. Il successo remoto riguarda quel commit; il nuovo runner diagnostico di questo lotto ha soltanto la verifica locale descritta sotto. Nessun nuovo commit o push.

## Runner diagnostico nativo

[`managedDevServerDiagnostics.mjs`](../scripts/e2e/managedDevServerDiagnostics.mjs) traspila una copia byte-identica del repository dev-server corrente con TypeScript e usa la sua implementazione, Vite reale e processi Windows posseduti. Non modifica la guardia applicativa. Il runner conserva:

- target ed endpoint TCP prima della distruzione del socket, eventi connect/error/timeout/close;
- righe `netstat` delle connessioni all'indirizzo alternativo e dei listener ammessi, PID e bind dichiarati dal server;
- output npm, errori, sorgente/hash, runner e workspace anche nei casi riusciti;
- copia e readback SHA-256 dei file delle fixture prima della pulizia; le fixture fallite restano in sede.

Comando su Windows con dipendenze di sviluppo già installate:

```powershell
node scripts/e2e/managedDevServerDiagnostics.mjs 5
```

Sono ammessi da 1 a 20 cicli; ogni ciclo esegue cinque casi. Le quantità 0 e 21 sono state rifiutate prima della creazione delle fixture. Le ricevute sono in una nuova directory `managed-dev-diagnostics-*` sotto `OnlyRag-Live` del profilo corrente, oppure sotto `ONLYRAG_LIVE_ROOT` se esplicitamente configurato. Gli snapshot sincroni dei listener perturbano i tempi: questa campagna non misura latenza o prestazioni.

### Campagna eseguita

Node **24.20.0**, Windows, **5 cicli / 25 casi passati**, **421 connessioni** osservate. Per ciascun ciclo:

| Caso | Esito |
| --- | --- |
| Vite ordinario su `127.0.0.1` | Avvio, HTTP 200, listener dichiarato e stop posseduto |
| TCP self-connect forzato su `127.0.0.2` | Endpoint identici conservati; non scambiato per listener esterno |
| Unico successo di readiness | Nessun secondo probe TCP di readiness; HTTP 200 |
| Bind wildcard IPv4 `0.0.0.0` | Rifiutato dalla guardia, processo posseduto arrestato |
| Bind wildcard IPv6 `::` | Rifiutato dalla guardia, processo posseduto arrestato |

**Intermittenza non riprodotta, causa ancora ignota.** Nessuna esposizione della configurazione corretta dimostrata. Il prossimo passo resta acquisire una riproduzione fallita con endpoint/listener/PID attribuibili; non si allentano bind loopback, controllo dei processi o criteri di accettazione per ottenere una chiusura.

## Controlli e conservazione

`npx vitest run` sui tre file worker/dev-server/audit, **in copia isolata**, con coverage: **24 passati / 3 file**, 30,11 s. La retention con tutte le identità per passo impiega 228 ms in questa esecuzione. Le soglie aggregate sono azzerate soltanto per la selezione mirata, che non pretende di misurare la copertura dell'intera applicazione. Il controllo include protezione del server estraneo, wildcard IPv4/IPv6, porta errata, entrambe le scadenze worker e writer durevole; non è una nuova suite completa.

Passano `npm run quality:static` (867 file, 107 handler IPC), `npm run typecheck`, `node --check` del runner, `npm run docs:check` (103 pagine) e `git diff --check`. Non si rieseguono Python completo, build o app installata: runtime, dipendenze e configurazione applicativa non cambiano; i relativi risultati remoti restano attribuiti a `e48c468`. Tutti i **66 file** di `userdata_dev` conservano gli hash iniziali, incluso l'audit corrente; questo non recupera la baseline storica mancante.

Un controllo aggiuntivo del prerequisito `DEPENDENCY-BRACES-UPSTREAM-01` trova ancora **3.0.3** come versione pubblicata nel registro npm: nessun sostituto upstream qualificabile del fork locale, nessuna dipendenza modificata. Il task conserva tutti i gate previsti.

Evidenze nuove:

- `C:/Users/Utente/OnlyRag-Live/tracker-loopback-20261020-90fcf91b`: tracker iniziale, readback/log CI, log mirati, confronto profilo, riepilogo, controlli e manifesto finale;
- `C:/Users/Utente/OnlyRag-Live/managed-dev-diagnostics-ce3c70b5-3402-46a8-98b9-e559b11ccc21`: campagna finale, sorgente e runner corrispondenti, 155 file di fixture copiati/verificati;
- `C:/Users/Utente/OnlyRag-Live/managed-dev-diagnostics-4bb7fb9a-c481-416d-a042-34d3b04d3e9a`: primo ciclo esplorativo di cinque casi, distinto dalla campagna finale.

Nessun processo o workspace della campagna rimane attivo. Output/cache preesistenti, vecchi target di cleanup rifiutati, candidati e prove storiche rimangono conservati. Il task audit baseline resta aperto; nessuna nuova chiamata modello, installazione o migrazione.

La revisione automatica ha invece rifiutato **prima dell'esecuzione** la pulizia PowerShell della nuova copia isolata dei test: `blocked by policy`, senza ulteriori dettagli. L'intero root `C:/Users/Utente/AppData/Local/Temp/onlyrag-loopback-check-1245f2b370e04241bf23ed7d1f8dd1d3`, inclusa la junction `node_modules` verso le dipendenze del checkout principale, resta conservato. Nessun metodo alternativo di rimozione. Otto file sorgente/config corrispondenti e il riepilogo coverage sono stati copiati con verifica separata; ricevuta `cleanup-rejection.json` nel root tracker. Il residuo è aggiunto a `RETAINED-RESIDUE-DISPOSAL-01`, senza nuovo ID. Questo rifiuto non riguarda la pulizia già riuscita delle 25 fixture del runner.

Fonti primarie: [API net di Node 24.20.0](https://github.com/nodejs/node/blob/v24.20.0/doc/api/net.md), [registro npm braces](https://registry.npmjs.org/braces/latest). Le API del runner sono verificate sul runtime installato; nessuna attribuzione della causa storica deriva dalla sola documentazione.
