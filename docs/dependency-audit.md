# Audit dipendenze — 2026-08-26

Snapshot del manifest Node.js e del lockfile. Le versioni effettive sono quelle risolte in `package-lock.json`; questo registro non sostituisce i manifest.

Runtime target: Node.js `22–25` (`.nvmrc` = `22`) e Python `3.12` (`.python-version` = `3.12`). Nel PC usato per questa verifica sono presenti Node.js `24.19.0`/npm `11.17.0` e Python `3.12.10`.

## Esito

| Controllo | Risultato | Interpretazione |
| :--- | :--- | :--- |
| `npm audit` | 0 vulnerabilità su 710 dipendenze | Nessuna CVE npm nota nel grafo installato al momento dell’audit. |
| `npm outdated` | 3 aggiornamenti major disponibili | `electron` 43.4.1 → 44.0.0, `js-yaml` 4.3.1 → 5.4.0, `typescript` 6.0.3 → 7.0.2: rinviati per rischio compatibilità. |
| `knip` | Nessun output | Nessun modulo morto rilevato dal controllo configurato. |
| `depcheck` | Nessuna dipendenza runtime; `tailwindcss` segnalato come devDependency | Falso positivo: è consumato dalla sintassi CSS `@import "tailwindcss"` e dalla configurazione Tailwind/Vite. |
| `dpdm` | Nessun ciclo | Nessuna ridondanza strutturale rilevata nel grafo analizzato. |

## Modifica applicata

Aggiornato soltanto `knip` `6.32.2 → 6.32.3`, patch compatibile; `package.json` e `package-lock.json` sono stati rigenerati da npm. Non sono stati rimossi moduli: nessuna rimozione era dimostrata sicura.

Versioni correlate verificate: Electron `43.4.1`, Vite `8.2.2`, Vitest `4.1.11`, TypeScript `6.0.3`, React/React DOM `19.2.8`, `node-pty` `1.1.0`, Python `3.12.10`, PyInstaller `6.22.2`, `puremagic` `2.2.0`.

## Rischi e follow-up

- **Basso:** mantenere `knip` aggiornato con patch/minor compatibili e rieseguire `npm audit` a ogni release.
- **Medio:** pianificare una branch separata per Electron 44, con smoke test Windows e verifica del comportamento IPC/packaging.
- **Medio:** valutare `js-yaml` 5 e TypeScript 7 solo dopo typecheck, test completi e controllo delle API usate; non sono aggiornamenti automatici.
- **Ambiente:** `pytest` e `pyinstaller` restano dipendenze dev del virtualenv; `puremagic` è stato aggiunto al runtime perché importato da `sidecar/domain/router.py`.

## Validazione del snapshot

- `npm install`: PASS, audit npm finale a 0 vulnerabilità.
- `npm run build`: PASS, installer NSIS generato.
- `npm run typecheck`: PASS.
- `npm run test:fast`: FAIL preesistente e variabile per ordine/timeout: in questa esecuzione 1.555/1.557 test passano; restano 2 fallimenti nell’orchestratore e un `ENOENT` asincrono nei test sessione.
- `npm run test:sidecar`: PASS, 119 test superati con Python 3.12.10.
- `npm run package:win`: PASS; `sidecar_dist/sidecar/sidecar.exe` e la copia in `dist/win-unpacked/resources/sidecar/sidecar.exe` hanno lo stesso SHA-256 `69A0101337D920383D5A5EF9279DE379FECC6B7EC88332BB31293493CDA1DEA4`.
