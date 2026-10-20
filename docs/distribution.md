# Distribuzione locale

La sorgente del progetto dichiara MIT in [`LICENSE`](../LICENSE). Il candidato CPU combinato include componenti con licenze ulteriori; la politica locale selezionata per quel candidato e il testo da includere sono in [`DISTRIBUTION-LICENSE.md`](../DISTRIBUTION-LICENSE.md). Questa pagina descrive lo stato tecnico, non sostituisce i testi di licenza o la verifica dei diritti dei componenti.

## Build e artefatti

Il nuovo candidato locale `cpu-20261020-114718-c7ebd99c` include il recupero inflight aggiornato: installer 416.383.893 byte, payload 1.240.921.299 byte. [Misura, corrispondenza indipendente e avvio installato](./verification-candidate-footprint-2026-10-20.md). Il candidato non è pubblicato; i precedenti conservano il proprio valore storico e le proprie qualifiche.

- `npm run package:win` usa [`scripts/build_package.ps1`](../scripts/build_package.ps1) e la configurazione `build` di [`package.json`](../package.json). Produce una nuova directory `release/cpu-*` con installer NSIS, Sidecar CPU e materiali di licenza; il comando non installa né pubblica.
- Il candidato conservato con qualifica frozen del 19 ottobre 2026 è `release/cpu-20261018-220641-87a891b9`, dai sorgenti puliti `95752a0`. Installer estratto indipendentemente, 1.111 file sorgente, 3.589 file del payload, 914 notice e 30 moduli Python più entrypoint hanno corrispondenza verificata. È **non firmato**. [Ricevuta e limiti](./verification-current-source-2026-10-19.md). L'[inventario dei tre candidati conservati](./verification-release-inventory-2026-10-19.md) include anche quello del 19 ottobre: nessuno viene riclassificato come build del runtime locale successivo.
- Il candidato corrente passa avvio isolato, autenticazione Sidecar, OCR CPU, PDF Unicode e ricerca fallback. Passa anche recupero chat/bozze sul desktop confezionato con servizi simulati e profili isolati. Passano inoltre 29 regressioni HTTP frozen, contenimento XLS e 17 ingestioni tramite IPC reale, traduzione PDF/DOCX con fixture sintetiche e rilettura dopo riapertura. Il replay semantico storico della traduzione appartiene ai candidati precedenti e non è stato ripetuto su questo artefatto.

## Gate prima della distribuzione

Restano aperti la riconciliazione dei diritti dei file realmente installati, la completezza del sorgente corrispondente, il percorso di aggiornamento/rollback, la qualificazione su hardware e la consegna pubblica di installer e sorgente. Il [`tracker`](../PROJECT_STATUS.json) distingue questi gate. Nessun installer o archivio è stato pubblicato come esito di questa documentazione.

Dettaglio e inventari verificabili: [`distribution-cpu-release.md`](./distribution-cpu-release.md), [`distribution-licenses.md`](./distribution-licenses.md), [`distribution-agpl-proposal.md`](./distribution-agpl-proposal.md), [`licenses/`](./licenses/). Le fotografie dei candidati precedenti restano prove storiche, non specifiche dell'ultimo build.
