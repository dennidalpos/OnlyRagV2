# Audit dipendenze — 2026-08-26

Snapshot del manifest Node.js e del lockfile. Le versioni effettive sono quelle risolte in `package-lock.json`; questo registro non sostituisce i manifest.

Runtime target: Node.js `22–25` (`.nvmrc` = `22`) e Python `3.12` (`.python-version` = `3.12`). Nel PC usato per questa verifica sono presenti Node.js `24.19.0`/npm `11.17.0` e Python `3.12.10`.

## Esito

| Controllo | Risultato | Interpretazione |
| :--- | :--- | :--- |
| `npm audit --audit-level=low` | 0 vulnerabilità su 613 pacchetti | Nessuna CVE npm nota nel grafo installato al momento dell’audit. |
| `npm outdated` | 3 aggiornamenti major disponibili | `electron` 43.4.1 → 44.0.0, `js-yaml` 4.3.1 → 5.4.0, `typescript` 6.0.3 → 7.0.2: rinviati per rischio compatibilità. |
| `knip` | Nessun output | Nessun modulo morto rilevato dal controllo configurato. |
| `depcheck --json` | Nessuna dipendenza runtime; `tailwindcss` segnalato come devDependency | Falso positivo: è consumato da `vite.config.mts` e dalla sintassi CSS `@import "tailwindcss"`; il codice d’uso è presente. |
| `dpdm` | Nessun ciclo su 301 moduli analizzati | Nessuna ridondanza strutturale rilevata nel grafo analizzato. |

## Modifica applicata

Aggiornate con `npm update` soltanto versioni compatibili patch/minor già ammesse dai range: `@types/node` `26.2.0 → 26.3.0`, `@types/react-dom` `19.2.4 → 19.2.5`, `@vitejs/plugin-react` `6.0.5 → 6.1.0`, Electron `43.4.0 → 43.4.1`, `happy-dom` `20.11.2 → 20.11.6`, `knip` `6.32.2 → 6.32.3`, `lucide-react` `1.31.0 → 1.34.0`, Vite `8.2.1 → 8.2.2` e Vitest `4.1.10 → 4.1.11`. `package.json` non è cambiato; `package-lock.json` e `node_modules` sono stati riallineati. Non sono stati rimossi moduli: nessuna rimozione era dimostrata sicura.

Versioni correlate verificate: Electron `43.4.1`, Vite `8.2.2`, Vitest `4.1.11`, TypeScript `6.0.3`, React/React DOM `19.2.8`, `node-pty` `1.1.0`, Python `3.12.10`, PyInstaller `6.22.2`, `puremagic` `2.2.0`.

## Rischi e follow-up

- **Basso:** rieseguire `npm audit`, `npm outdated`, Knip e Depcheck a ogni release; il segnale `tailwindcss` resta un falso positivo documentato.
- **Medio:** pianificare una branch separata per Electron 44, con smoke test Windows e verifica del comportamento IPC/packaging.
- **Medio:** valutare `js-yaml` 5 e TypeScript 7 solo dopo typecheck, test completi e controllo delle API usate; non sono aggiornamenti automatici.
- **Ambiente:** `pytest` e `pyinstaller` restano dipendenze dev del virtualenv; `puremagic` è stato aggiunto al runtime perché importato da `sidecar/domain/router.py`.

## Validazione del snapshot

- `npm update @types/node @types/react-dom @vitejs/plugin-react happy-dom knip lucide-react vite vitest`: PASS; installazione riallineata e audit npm finale a 0 vulnerabilità.
- `npm ls --depth=0`: PASS, nessun pacchetto invalid o extraneous.
- `npm run build`: PASS, installer NSIS generato.
- `npm run typecheck`: PASS.
- `npm run lint`: PASS, inclusi typecheck, `npm run test:fast` con 1.558/1.558 test, build Vite/Electron e smoke del bundle. La rejection asincrona `ENOENT` del salvataggio sessione è stata corretta nel writer atomico e coperta da regressione.
- `npm run test:sidecar`: PASS, 119 test superati con Python 3.12.10.
- `npm run package:win`: PASS; `sidecar_dist/sidecar/sidecar.exe` e la copia in `dist/win-unpacked/resources/sidecar/sidecar.exe` hanno lo stesso SHA-256 `69A0101337D920383D5A5EF9279DE379FECC6B7EC88332BB31293493CDA1DEA4`.
