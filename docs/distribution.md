# Candidati Windows locali

La fase corrente è lo [sviluppo locale approvato](./local-development-policy-2026-10-20.md). La distribuzione pubblica e le relative qualifiche sono ritirate dal backlog: i vecchi gate non sono attività aperte nel tracker (SecondBrain: `02-areas/products/OnlyRagV2/tracker.json`). Le decisioni di licenza e le evidenze degli artefatti rimangono conservate.

## Costruire un candidato

`npm run package:win` richiama [build_package.ps1](../scripts/build_package.ps1): crea un nuovo `release/cpu-*`, prepara un venv CPU separato in `build/release-cpu/venv`, installa i requisiti release ed esegue compilazione Sidecar, build/smoke e packaging NSIS. Produce installer, notice, manifest/hash e archivio sorgenti associato. Il comando non installa l'app e passa `--publish never` al builder.

Lo script rifiuta `-SkipSidecar`. `-RequireSignature` richiede una firma valida; il candidato può essere non firmato senza tale opzione. Una build riuscita non prova installazione, aggiornamento, correttezza semantica o corrispondenza con un candidato precedente. I gate pre-commit sono in [AGENTS.md](../AGENTS.md#comandi-e-verifica); gli effetti dei comandi sono in [operazioni](./operations.md).

## Licenze e conservazione

Il sorgente originale dichiara MIT in [LICENSE](../LICENSE). La scelta approvata per il candidato combinato è documentata in [DISTRIBUTION-LICENSE.md](../DISTRIBUTION-LICENSE.md); la nota del pacchetto non è una dichiarazione di qualifica della consegna pubblica. Non attribuire a un audit locale la verifica di tutti i diritti dei componenti o del sorgente di ogni binario.

NSIS conserva app data (`deleteAppDataOnUninstall: false` in [package.json](../package.json)). Installer, profili sintetici, backup, sorgenti corrispondenti e fallimenti conservati non sono eliminabili dal solo nome o dal ritiro del task.

## Artefatti ed evidenze datate

- [Implementazione CPU e candidati](./distribution-cpu-release.md), [inventario del 19 ottobre](./verification-release-inventory-2026-10-19.md), [corrispondenza sorgente/frozen](./verification-current-source-2026-10-19.md).
- [Footprint e avvio installato](./verification-candidate-footprint-2026-10-20.md), [XLS installato](./verification-installed-xls-2026-10-20.md), [impostazioni installate](./verification-installed-settings-2026-10-20.md). Ogni rapporto identifica il proprio candidato; non esiste qui una qualifica automatica dell'ultimo runtime.
- [Decisione AGPL](./distribution-agpl-proposal.md), [riesame licenze](./distribution-licenses.md), [testi e attribuzioni](./licenses/).

La pubblicazione del repository sorgente è distinta dalla consegna di installer e relativi materiali: le vecchie frasi «nothing published» nei rapporti riguardano il lotto e gli artefatti descritti.
