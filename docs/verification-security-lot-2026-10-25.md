# Lotto tracker: advisory e wrapper pnpm — 25 ottobre 2026

Lotto selezionato dall'ordine del [passaggio di consegne](./session-handoff-audit-2026-10-25.md), su `master` base `5b1c30e0297c078f579bfc342e343a01108170db`, inizialmente senza modifiche versionate. Perimetro: `DEPENDENCY-CURRENT-ADVISORIES-01` e `VERIFICATION-PNPM-CONFIG-NETWORK-01`. Le altre attività restano fuori lotto, con priorità, dipendenze e criteri conservati. Nessun commit o push richiesto in questa sessione.

## Dipendenze

| Pacchetto | Prima | Dopo |
| --- | --- | --- |
| Zod | 4.4.3 | 4.6.7 |
| Happy DOM | 20.11.6 | 21.0.4 |
| Vitest, mocker e provider V8 | 4.1.11 | 4.1.12 |
| Undici runtime / node-gyp | 7.30.0 / 6.29.0 | 7.30.1 / 6.29.1 |
| fast-uri | 3.1.8 | 3.1.9 |

L'aggiornamento è circoscritto alle dipendenze segnalate e alla loro chiusura transitiva compatibile. Il lock conserva le versioni di Electron, Vite, React, TypeScript, Monaco, DOMPurify e il fork braces. La risoluzione allinea la famiglia Vitest e aggiorna sette dipendenze di supporto entro gli intervalli dei rispettivi parent; il delta completo è nella ricevuta esterna `dependency-delta.json`. Nessun nuovo override o aggiornamento generale della toolchain.

`npm ci` in una nuova copia sorgenti installa un albero indipendente, senza junction verso il checkout. L'audit iniziale rileva sette nomi di pacchetto affetti (tre high e quattro moderate); quelli successivi nella copia e nel checkout restituiscono zero advisory. Il readback di tutti gli otto percorsi interessati confronta il vero `package.json` installato con il lock e conserva gli integrity digest npm. Anche il checkout è ricreato con `npm ci`: 4.487 file dei pacchetti interessati coincidono byte per byte con l'installazione indipendente. Restano avvisi npm per dipendenze transitive deprecate; non sono convertiti in una dichiarazione di supporto generale o in task applicativi non verificati.

Le regressioni in [currentDependencyBoundaries.test.mts](../scripts/currentDependencyBoundaries.test.mts) richiedono rifiuto di array/set/map sovradimensionati prima di visitare gli elementi, anche dentro un oggetto, e conservazione della validazione dei valori ammessi. Sette casi falliscono sul vecchio Zod. Due processi Node distinti esercitano le copie Undici con un server loopback posseduto: sei content encoding e chiusura anticipata devono produrre un rifiuto gestito; la richiesta ordinaria successiva deve riuscire senza errore asincrono non gestito. fast-uri deve mantenere malformato lo schema percent-encoded, senza promuoverlo a HTTPS.

### Esposizione e fonti primarie

- Zod valida IPC, REST client, contratti agente e stato persistito. Il trusted-sender check precede la validazione IPC; la presenza di limiti di collezione e il costo osservato confermano la rilevanza della correzione, senza dimostrare uno sfruttamento remoto. [Correzione upstream](https://github.com/colinhacks/zod/pull/6652).
- Happy DOM è un ambiente di test, non il renderer Electron distribuito. L'advisory richiede valutazione JavaScript e HTML/moduli controllati dall'attaccante; il repository esegue fixture locali. Metadati dell'[advisory](https://github.com/capricorn86/happy-dom/security/advisories/GHSA-834v-8h66-3h79) e [release 21.0.4](https://github.com/capricorn86/happy-dom/releases/tag/v21.0.4) indicano la correzione; il vecchio testo della descrizione conserva ancora «No patched version». Non viene eseguito il payload di accesso al filesystem host.
- Vitest/mocker e provider V8 restano allineati a 4.1.12. L'[advisory Windows](https://github.com/vitest-dev/vitest/security/advisories/GHSA-xp26-3454-mjgp) riguarda il redirect del server mocker con percorso controllato dall'attaccante; la configurazione ordinaria del progetto usa `vitest run`, con fixture locali. La suite completa con coverage verifica anche la compatibilità del provider.
- Undici è transitivo di Cheerio, del download Electron e di node-gyp. Il client applicativo usa `node:http`/`node:https` e `cheerio.load`, non `cheerio.fromURL` o Undici fetch; il percorso HTTP vulnerabile resta pertinente alle dipendenze/tooling, senza exploit applicativo dimostrato. Entrambe le copie sono corrette secondo l'[advisory](https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c).
- fast-uri è transitivo di AJV nel tooling electron-builder. La correzione della decodifica dello schema è verificata con input sintetici; non viene attribuito un bypass del client HTTP dell'app. [Advisory](https://github.com/fastify/fast-uri/security/advisories/GHSA-w74x-v6f9-j3xg).

Gli engine dei pacchetti candidati ammettono Node 24.22.1 effettivamente usato; npm è 11.19.1. Il risultato locale non chiude alert remoti e non qualifica installer storici o assenza generale di vulnerabilità.

## Wrapper pnpm

[withVerificationEnvironment](../electron/core/infrastructure/process/powerShellCommand.ts) applica e ripristina sia `npm_config_offline=true` sia `pnpm_config_offline=true`, mantenendo i rifiuti di acquisizione/versione e i confini della directory. Il prefisso npm da solo e i flag pm/runtime-on-fail non impedivano la richiesta di metadati delle dipendenze di configurazione pnpm 12.

La [fixture PowerShell reale](../electron/core/infrastructure/process/persistentPowerShellSession.test.ts) parte con home/cache/config vuote, entrambe le opzioni offline esterne a `false` e un registro loopback che restituisce solo HTTP 500. Il wrapper precedente fallisce l'asserzione zero-request: viene osservata una richiesta. Il nuovo wrapper rifiuta esplicitamente il pin `pnpm@12.14.0` non preparato, con zero richieste e nessuno script sentinella o file acquisito nel progetto. La fixture positiva prepara solo semver locale offline, esegue lo script tramite lockfile e rilegge il documento sintetico. Restano testati il rifiuto della versione incompatibile, la conservazione del lock e il ripristino di ambiente presente/assente dopo successo e fallimento.

Fonti: [lockfile pnpm 12.14.0 e config dependencies](https://github.com/pnpm/pnpm/blob/v12.14.0/pnpm/docs/lockfile.md), [pmOnFail](https://pnpm.io/settings/cli#pmonfail). Le opzioni del package manager non costituiscono una sandbox di rete per script arbitrari.

## Verifiche e conservazione

| Controllo sui sorgenti finali | Esito |
| --- | --- |
| `npm run test:coverage` | **3.050 test / 331 file**, 265,79 s; statement 72,78%, branch 63,66%, funzioni 66,77%, righe 74,42%; tutte le soglie superate |
| `npm run test -- --reporter=dot`, ripetuto dopo il consolidamento della fixture | **3.050 test / 331 file**, 217,70 s |
| Suite Python completa, `-B -m pytest -p no:cacheprovider -q` | **699 passati, uno skip host**, 266,39 s |
| `scripts/check_python_critical.py` | **15 casi / otto controlli, nessuno skip** |
| Vitest mirato: nuovi confini, shell nativa e fork | **42 passati / tre file**, 17,98 s |
| `npm run build`, smoke Main, scanner nativo e worker Electron/ASAR | Passati; Electron 43.8.3, scanner sintetico 200 file / 550 KiB |
| YAML e proxy reali del builder, Monaco/Markdown in Electron | Passati; nessun modello o server esterno |
| Typecheck, `quality:static` | Passati; 892 file, 107 handler IPC |
| Knip normale/produzione, cicli, documentazione, diff | Passati; 132 Markdown, nessun ciclo |
| Audit npm e readback indipendente | Zero advisory in entrambe le installazioni, otto percorsi interessati coerenti col lock |

Lo skip Python è quello già noto per symlink di directory non disponibile sull'host. Il gate critico non salta alcun caso. Esiti portabili, integrità e chiusure sono nella [ricevuta del lotto](./evidence/security-lot-2026-10-25.json); i controlli documentali finali e Sync/Check sono registrati nei log esterni.

I primi controlli finali rilevano terminatori JSON e due dipendenze transitive assunte come dirette dalla nuova fixture. Corretti il formato e la risoluzione attraverso Cheerio/AJV/rebuild/node-gyp, usando entry point pubblici anche dove `package.json` non è esportato. La parità dei percorsi risolti conferma le stesse copie già provate; undici casi finali nel checkout e la suite completa finale passano. Nessuna modifica applicativa dopo build o coverage.

Conclusi e rimossi dalle attività aperte soltanto `DEPENDENCY-CURRENT-ADVISORIES-01` e `VERIFICATION-PNPM-CONFIG-NETWORK-01`, dopo i gate. Restano **10 attività autonome P2 e una P2 con disposizione del proprietario**. Braces resta upstream-blocked (`3.0.3` dal registro in questa sessione); il dev-server conserva il motivo storico non attribuito; gli altri record e tutte le note precedenti restano identici. Nessun nuovo residuo applicativo confermato da aggiungere.

Prima delle prove: 1.252 sorgenti tracciati copiati e verificati SHA-256; backup reale e readback dei 68 file correnti in `userdata_dev` e `logs`. Il solo test negativo iniziale condivide temporaneamente il vecchio `node_modules` tramite junction, rimossa prima del nuovo `npm ci`. Le suite positive usano dipendenze indipendenti. Python completo usa l'interprete del checkout con il solo overlay pytest esterno preesistente; il gate critico usa l'interprete esterno già predisposto. Nessuna modifica al `.venv` o ai modelli personali.

Radice esterna: `%TEMP%/onlyrag-security-lot-20261025-b8ff344b`. Sono conservati manifest, copie protette, audit, delta lock, log negativi/positivi e ricevute. Nessuna cancellazione di prove storiche o ritentativo dei cleanup precedentemente rifiutati. Il recupero del log storico resta aperto e non è sostituito dalla conservazione dei byte correnti.

Sync e successivo Check SecondBrain passano: 23 repository/checkout/direttive, zero segnalazioni. La revisione automatica rifiuta prima dell'esecuzione il comando combinato di copia finale, spostamento delle evidenze Monaco e pulizia della nuova copia `source/` e della cache Vitest del checkout. Motivo restituito soltanto `blocked by policy`: nessuna fase è eseguita e nessuna cancellazione alternativa è tentata. Restano `source/` con dipendenze indipendenti sotto la radice esterna, `node_modules/.vite` nel checkout e `%TEMP%/onlyrag-monaco-sanitizer-82bk2J`. La copia finale delle prove viene poi eseguita separatamente come sola lettura/copia. Ricevuta `cleanup-rejection.json` e nota operativa nel tracker; nessun nuovo task applicativo o riapertura di smaltimenti ritirati.
