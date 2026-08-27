# Audit dipendenze — 2026-08-27

Snapshot del manifest Node.js e del lockfile. Le versioni effettive sono quelle risolte in `package-lock.json`; questo registro non sostituisce i manifest.

Runtime target: Node.js `22–25` (`.nvmrc` = `22`) e Python `3.12` (`.python-version` = `3.12`). Nel PC usato per questa verifica sono presenti Node.js `24.19.0`/npm `11.17.0` e Python `3.12.10`.

## Esito

| Controllo | Risultato | Interpretazione |
| :--- | :--- | :--- |
| `npm audit --omit=dev` | 0 vulnerabilità su 160 dipendenze prod (709 pacchetti lockati) | Nessuna CVE npm nota nel grafo runtime installato al momento dell’audit. |
| `npm outdated` | 5 pacchetti fuori dall’ultima versione compatibile o major | Patch compatibili disponibili per `@types/node` e `happy-dom`; major rinviate per rischio compatibilità: `electron` 43.4.1 → 44.0.0, `js-yaml` 4.3.2 → 5.4.1, `typescript` 6.0.3 → 7.0.2. |
| `knip` | Nessun output | Nessun modulo morto o export inutilizzato rilevato dal controllo configurato. |
| `depcheck --json` | Nessuna dipendenza runtime; `tailwindcss` segnalato come devDependency | Falso positivo: è consumato da `vite.config.mts` e dalla sintassi CSS `@import "tailwindcss"`; il codice d’uso è presente. |
| `dpdm` | Nessun ciclo su 308 moduli analizzati | Nessuna ridondanza strutturale rilevata nel grafo analizzato. |

Il lockfile contiene 709 pacchetti: 562 MIT, 60 ISC, 24 MPL-2.0, 18 BSD-2-Clause,
13 BlueOak-1.0.0, 13 BSD-3-Clause, 12 Apache-2.0 e 7 con licenze singole o duali.
Un pacchetto transitive (`callsite@1.0.0`) non espone un campo `license` nel lockfile e il
tarball installato non include un file `LICENSE`; il README incluso e il repository upstream
[`tj/callsite`](https://github.com/tj/callsite) dichiarano però MIT. La licenza del progetto è
ora esplicita anche nel file [`LICENSE`](../LICENSE), incluso nell’artefatto npm.

Il progetto non dichiara `postinstall`, `install` o `prepare` propri. Nel grafo installato
eseguono lifecycle script nativi `@parcel/watcher`, `node-pty`, `fsevents` ed
`electron-winstaller`; sono build/selezione di binari, quindi `npm ci --ignore-scripts`
non è equivalente alla normale installazione. `electron` non espone lifecycle script nel
package.json installato.

## Modifica applicata

A seguito dell’audit è stato eseguito `npm dedupe`: il lockfile è passato da 710 a 709 pacchetti, ha rimosso una copia annidata di `ci-info` e ha mantenuto invariati `package.json` e i range dichiarati. Ha inoltre riallineato patch compatibili di `@types/node` (26.3.0 → 26.4.0), `js-yaml` (4.3.1 → 4.3.2) e la copia transitiva di `js-yaml` (3.15.1 → 3.15.2). Non sono state rimosse dipendenze dirette: nessuna rimozione era dimostrata sicura.

Versioni correlate verificate: Electron `43.4.1`, Vite `8.2.2`, Vitest `4.1.11`, TypeScript `6.0.3`, React/React DOM `19.2.8`, `node-pty` `1.1.0`, Python `3.12.10`, PyInstaller `6.22.2`, `puremagic` `2.2.0`.

## Rischi e follow-up

- **Basso:** rieseguire `npm audit`, `npm outdated`, Knip e Depcheck a ogni release; il segnale `tailwindcss` resta un falso positivo documentato.
- **Chiuso:** `callsite@1.0.0` è documentato con la fonte upstream MIT; il progetto distribuisce `LICENSE` e mantiene `"license": "MIT"` nel manifest.
- **Medio:** pianificare una branch separata per Electron 44, con smoke test Windows e verifica del comportamento IPC/packaging.
- **Medio:** valutare `js-yaml` 5 e TypeScript 7 solo dopo typecheck, test completi e controllo delle API usate; non sono aggiornamenti automatici.
- **Ambiente:** `pytest` e `pyinstaller` restano dipendenze dev del virtualenv; `puremagic` è stato aggiunto al runtime perché importato da `sidecar/domain/router.py`.

## Validazione del snapshot

- `npm dedupe`: PASS; lockfile da 710 a 709 pacchetti, senza modificare `package.json`.
- `npm audit --omit=dev`: PASS, 0 vulnerabilità runtime.
- `npx depcheck --json`: PASS per le dipendenze runtime; `tailwindcss` resta un falso positivo documentato.
- `npm ci --prefer-offline --no-audit --no-fund`: PASS, 611 pacchetti installati da lockfile dopo `npm cache verify`; warning non bloccanti sui transitivi deprecati `inflight`, `rimraf@2`, `glob@7`, `whatwg-encoding` e `boolean`.
- `npm run build`: PASS; typecheck, bundle Vite/Electron e packaging NSIS completati dopo il ripristino della connettività a `github.com`.
- `npm run dev -- --host 127.0.0.1`: PASS, Vite su `http://127.0.0.1:5173/`; Electron, Ollama e sidecar hanno inizializzato correttamente. Il sidecar ha avuto i consueti retry iniziali prima dell’health check positivo.
- `npm ls --depth=0 --omit=optional`: PASS, nessun pacchetto invalid o extraneous.
- `npm run lint`: PASS, 164 file di test e 1.587 test superati, typecheck, build Vite/Electron e smoke del bundle inclusi.
- Baseline precedente alla pulizia: `npx vitest run electron/core/domain/sidecarContract.test.ts` PASS (2/2), `npx tsc --noEmit` PASS, `npm run test:sidecar` PASS (128 test). Il test mirato `agentInterviewAppService.test.ts` passa 5/5 dopo l’installazione pulita.
