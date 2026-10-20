# Passaggio di sessione: seguito del tracker — 20 ottobre 2026

Richiesta esplicita del proprietario: salvare il lavoro, commit sul branch principale e push, aggiornando il tracker per il cambio di sessione. Destinazione verificata tramite GitHub e fetch: repository pubblico [dennidalpos/OnlyRagV2](https://github.com/dennidalpos/OnlyRagV2), default branch `master`, base `f1dd1b72d121e874247f0559f25a493bdf8bd540`, divergenza iniziale 0/0. La consegna è identificata dal commit che contiene questo documento; SHA effettivo, conferma del push e stato della sua CI sono riletti e registrati nel dossier SecondBrain. Le ricevute precedenti conservano il proprio stato storico.

## Lavoro salvato e tracker

Il [riepilogo delle qualifiche](./verification-tracker-followup-2026-10-20.md) documenta cinque attività concluse e rimosse: riconciliazione inflight con ispezione/abbandono esplicito, impostazioni installate, dimensioni del candidato, valutazione del chunking conclusa con rifiuto del candidato e ammissione XLS installata. La consegna comprende implementazione, regressioni, runner isolati e ricevute; nessuna modifica runtime aggiunta dal passaggio di pubblicazione.

[PROJECT_STATUS.json](../PROJECT_STATUS.json) conserva **33 attività aperte: 15 autonome e 18 owner-required; 4 P1, 25 P2, 4 P3**. I 32 record aperti al termine della qualifica XLS, priorità, liste e criteri sono invariati; si aggiunge soltanto il residuo CI P2 verificato durante la pubblicazione.

## Ripresa dalla prossima sessione

1. Rileggere AGENTS.md, tracker, stato Git e dossier OnlyRagV2 in SecondBrain. Verificare la CI dell'esatto SHA di questa consegna. Il [run di base f1dd1b7](https://github.com/dennidalpos/OnlyRagV2/actions/runs/39414623075) è `completed/failure`: il caso di retention audit da 1.005 append reali supera 30 secondi sotto coverage. La suite locale attuale passa, senza dimostrare risolto il problema del runner. Nuovo `CI-CAPABILITY-AUDIT-RETENTION-TIMEOUT-01`, P2: preservare limite, ordinamento e garanzie del writer, diagnosticare prima di cambiare fixture/runtime; non aumentare soltanto il timeout.
2. Per le prestazioni RAG resta pendente la scelta del carico rappresentativo e della latenza. Sono state proposte prove sintetiche 10k/100k chunk con Nomic 768D e BGE 1024D, letture durante aggiornamenti, soglia di 2 oppure 5 secondi; nessuna scelta ricevuta. Non dichiarare concordata una delle alternative.
3. `AGENT-REQUEST-LEDGER-LIVE-QUALIFICATION-01`: la campagna distinta autorizzata ha esaurito **8 chiamate reali**, quattro estrazioni e quattro candidati. Audit completo riletto dopo riavvio installato, estrazione semanticamente accettata 1/4, nessun piano nativo accettato nel budget; sette richieste aggiuntive bloccate prima dell'inferenza. Non riutilizzare/azzerare marker, non effettuare altre inferenze ledger senza nuovo perimetro esplicito. I flussi limitati dal budget non equivalgono a quattro review semantiche complete fallite.
4. `QUALITY-CONTENT-LIVE-QUALIFICATION-01` rimane P1: raccolta reale Qwen/Nomic completa, accettazione congiunta 5/12, lingua 5/12, contenuto e citazioni 10/12, retrieval globale 9/11. Non indebolire le aspettative. Chunking valutato senza guadagno e non integrato.
5. Proseguire gli altri record secondo priorità e dipendenze effettive. Migrazione dei dati personali, perdita di alimentazione, diritti/firma/pubblicazione installer e smaltimento delle evidenze mantengono i propri criteri e permessi.

L'autorizzazione a candidato Windows, installazione isolata e modelli locali su dati di prova resta registrata, insieme al limite ledger più specifico ora esaurito. Questa pubblicazione riguarda i sorgenti e le ricevute versionate.

## Verifiche pre-commit

Gate ripetuti sulla consegna prima del commit:

| Controllo | Esito |
| --- | --- |
| `npm run test` | 2.952 test passati, 323 file, 191,20 s |
| `.venv/Scripts/python.exe -B -m pytest -q -rs --tb=short -p no:cacheprovider` | 622 passati, un symlink di directory non disponibile saltato, 167,78 s; junction reali eseguite |
| `pwsh -NoProfile -File scripts/lint_format.ps1 -Fast -SkipTests` | Formato, documentazione, JSON, typecheck, compilazione Python con cache esterna, 15 casi Python critici, 31+17 cleanup isolati, build e smoke Electron passati |
| `npm run quality:static` | 863 file, 107 handler IPC, nessuna correzione automatica |
| `npm run audit:deadcode`, `npm run audit:cycles` | Knip normale/produzione e assenza di cicli passano |
| `npm run docs:check`, sintassi nuovi runner e diff | 94 documenti, nuovi Python/MJS e diff verificati |

I controlli nativi/installati e le campagne reali già concluse restano quelli delle ricevute datate; non sono ripetuti durante la pubblicazione. Il fallimento CI di base resta un residuo, anche con questi gate locali verdi. Scansione limitata dei formati comuni di token/chiavi sui file della consegna senza riscontri; non è una certificazione generale di assenza di segreti.

## Artefatti e conservazione

Candidato locale finale `release/cpu-20261020-130728-0e85c502`, installer SHA-256 `7467194090ecd428351de480a35dba7e68cb3299f13c49a06978124d387e3706`; il precedente candidato resta intermedio. Installer, build, dipendenze, profili, store e output completi esterni non entrano nel commit. Entrambe le installazioni temporanee e le registrazioni sono state rimosse con uninstaller, senza flag di eliminazione dei dati.

Evidenze durevoli, incluse prove fallite e manifest SHA-256:

- `C:/Users/Utente/OnlyRag-Live/tracker-followup-20261020-c9663097`: copia del primo seguito.
- `C:/Users/Utente/OnlyRag-Live/request-ledger-bounded-20261020-v1`: manifesto completo 151 file, SHA-256 `bc5105c794f4c4267bde71498a1703ba2ba8f15cece76ab4128d888d5832a584`.
- `C:/Users/Utente/OnlyRag-Live/installed-xls-20261020-v1`: manifesto completo 327 file, SHA-256 `285041cba85c0a11d75db8e92eaf2e4a27d4075b118a44bf4ff1d25a9e08537f`.

I root ledger/XLS sono sigillati: non sovrascriverli per registrare la pubblicazione. Nuovi log, patch e snapshot di recupero sono conservati in `C:/Users/Utente/OnlyRag-Live/source-publication-20261020-b617f8d1`; i file copiati sono verificati con SHA-256. Il dossier registra anche SHA del commit e readback del push/CI.

La revisione automatica ha rifiutato la rimozione dei quattro staging di estrazione e, successivamente, di tredici duplicati log TEMP prima dell'esecuzione: **blocked by policy**, senza altra spiegazione. Originali conservati, copie verificate disponibili, nessun metodo alternativo tentato. `RETAINED-RESIDUE-DISPOSAL-01` conserva entrambi i residui e la precedente lacuna di evidenze TEMP di causa non verificata. Durante la pubblicazione è stata rifiutata anche la rimozione della nuova cache compilazione Python esterna `C:/Users/Utente/AppData/Local/Temp/onlyrag-publication-8e6f3f85c92347fdb9dd452bd6913357/python-cache`, prima dell'esecuzione dell'intero comando: stesso motivo **blocked by policy**, nessun dettaglio ulteriore. Cache conservata e aggiunta allo stesso task, senza nuovo ID né metodi alternativi di cancellazione. Il backup/log è eseguito successivamente con una copia separata non distruttiva.
