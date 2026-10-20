# Passaggio di sessione: avvio Sidecar e verifiche locali — 20 ottobre 2026

Richiesta esplicita: salvare il lavoro, aggiornare tracker, commit sul branch principale e push. Destinazione verificata: repository pubblico [dennidalpos/OnlyRagV2](https://github.com/dennidalpos/OnlyRagV2), default `master`, base `e48c468bb6559cc0a57ff3b40ef0635fc301333b`; fetch iniziale allineato 0/0. Il commit contenente questo documento identifica la consegna. SHA risultante, push e readback CI sono registrati nel dossier SecondBrain e nelle ricevute esterne.

## Lavoro salvato

- [Sidecar dev](./verification-sidecar-dev-startup-2026-10-20.md): durante preparazione Python/readiness lo stato è `checking`, condiviso dagli avvii concorrenti; il widget mostra `Verifica...`. Fallimenti terminali, errori e guasti successivi rimangono offline. Ventisei regressioni mirate e prove reali Python/Electron su profili isolati passano. Riavviare `npm run dev` per caricare il Main aggiornato.
- [Ripresa tracker](./verification-tracker-resume-2026-10-20.md): CI dell'esatto `e48c468` completata con successo; diagnosi storiche worker/retention ancora aperte. Nuovo runner diagnostico dev-server, 25 casi nativi e 24 regressioni mirate passati, intermittenza non riprodotta e guardia invariata.
- [Confronto lingua](./plan-chat-language-2026-10-20.md): preparazione offline e 24 input congelati verificati. Il proprietario ha risposto **«Mantieni il perimetro solo offline»**: zero inferenze, nessuna esecuzione pianificata e candidato non integrato.

[Tracker](../PROJECT_STATUS.json): **34 attività aperte, 15 autonome / 19 owner-required, 4 P1 / 27 P2 / 3 P3**. Stessi ID, priorità, ordine, liste, criteri e note precedenti; nessuna chiusura nella presente consegna. Il difetto Sidecar corretto è descritto nel suo resoconto, senza nuovo task aperto duplicato. L'ulteriore runtime modificato conserva il gate di distribuzione sullo stesso artefatto.

## Ripresa

1. Leggere AGENTS, dossier, tracker e stato Git. Rileggere la CI dell'esatto commit contenente questo documento: il verde della base `e48c468` non è il risultato della nuova consegna. I due task CI mantengono la diagnosi storica non dimostrata.
2. Mantenere **solo offline** per i modelli. I 24 payload del piano lingua sono proposti, non autorizzati; le otto chiamate ledger precedenti rimangono spese. Non riscrivere aspettative, fallimenti o marker. Pubblicare i sorgenti non autorizza campagne modello, installazioni, migrazioni personali o installer pubblici.
3. Conservare `DEV-AUDIT-HISTORY-RECOVERY-01`: 42 eventi aggiunti nelle suite antecedenti, baseline iniziale non recuperata, nessun backup dichiarato. Le copie successive e l'hash iniziale non ricostruiscono i record espulsi; serve recupero verificato o disposizione esplicita del proprietario. Le suite complete restano in copia sorgente isolata con hash prima/dopo del profilo principale.
4. Per il dev, `.venv` è stato ricreato automaticamente dall'app il 20 ottobre; import runtime e pip check passano. Non contiene necessariamente le dipendenze di test. Questa consegna riusa, senza modificarlo, un Python dev esterno verificato 3.13.15/pytest 9.1.1 per i gate completi.
5. Preservare i target storici con rifiuto automatico di pulizia e il root indisponibile della sanificazione, come registrato in `RETAINED-RESIDUE-DISPOSAL-01`. La copia test loopback trattenuta contiene una junction `node_modules` verso il checkout: ispezionare proprietà e percorsi prima di qualsiasi futura manutenzione.

## Gate pre-commit

Controlli eseguiti in una nuova copia isolata: **1.194 file byte-identici**, metadati Git e audit sentinella. Dipendenze Node condivise con il checkout e Python dev esterno 3.13.15/pytest 9.1.1 tramite junction censite. Nessun esito è dedotto dalla precedente consegna.

| Gate | Esito |
| --- | --- |
| `npm run test -- --coverage --reporter=dot` | **2.960 passati / 323 file**, 220,74 s; statement 72,34%, branch 63,40%, funzioni 66,31%, righe 73,99% |
| Python dev `-B -m pytest -q -rs --tb=short -p no:cacheprovider` | **666 passati / uno skip**, 169,55 s; symlink directory non consentiti dall'host, junction eseguite |
| Gate Python critico attraverso `lint_format.ps1 -Fast -SkipTests` | **15 passati, nessun caso mancante/saltato**, 8,40 s |
| Gate seriale | Formato/diff, documentazione, JSON, typecheck, sintassi Python, 31 casi cleanup WhatIf, 17 casi log cleanup, build e smoke Main Electron passati |
| `npm run quality:static`, `npm run audit:deadcode`, `npm run audit:cycles` | Passati; 867 file/107 IPC, Knip normale/produzione, nessun ciclo |
| Conservazione | Tutti i **66 file** attuali `userdata_dev`, audit sentinella e log del profilo dev reale invariati |

La prima invocazione pytest aveva un argomento XML malformato e si è fermata con exit 4 prima di raccogliere test. Log conservato; il comando corretto esegue l'intera suite sopra. Dopo i gate cambiano soltanto tracker e resoconto della consegna; corrispondenza dei sorgenti runtime/test/config ricontrollata prima del commit. Nessuna nuova inferenza o qualifica installata.

## Evidenze e limiti

Backup Git completo verificato, stato iniziale, tracker precedente, log e corrispondenze della consegna: `C:/Users/Utente/OnlyRag-Live/session-publication-20261020-8a25e6b6`.

La nuova copia di verifica è trasferita da `TEMP/onlyrag-session-publication-0cd4464bc4c04cdaae7743c7cd2531ad` a `verification-source/` nello stesso root durevole: **1.768 file** con readback SHA-256, nessun file scartato, storia Git invariata. `fixture-location-map.json` risolve i percorsi originali nei log; le junction `node_modules` verso il checkout e `.venv` verso il Python dev esterno sono censite e non attraversate. Ispezionarle prima di futura manutenzione; non trattare la copia come un ambiente indipendente dalle sue dipendenze condivise.

La revisione automatica ha rifiutato **prima dell'esecuzione** la rimozione nativa PowerShell della nuova cache di compilazione `python-cache/` nello stesso root durevole: `blocked by policy`, nessun ulteriore dettaglio. Tutti i 70 file `.pyc` restano in sede, senza cancellazioni alternative; ricevuta `cleanup-rejection.json` e residuo aggiunto a `RETAINED-RESIDUE-DISPOSAL-01`, senza nuovo ID. Il rifiuto non riguarda il trasferimento già riuscito della copia di verifica né i target storici, rimasti intatti.

Evidenze dei lotti salvati: `tracker-loopback-20261020-90fcf91b`, `managed-dev-diagnostics-ce3c70b5-3402-46a8-98b9-e559b11ccc21`, `chat-language-preflight-20261020-adfbef33`, `sidecar-dev-startup-20261020-c7e2c38d`, sotto `C:/Users/Utente/OnlyRag-Live`. I percorsi TEMP storici della campagna contenuti si risolvono nella copia durevole `tracker-followup-20261020-c9663097/live` verificata nel piano.

Nessun commit o push SecondBrain, nessuna pubblicazione installer. La consegna riguarda i sorgenti e la documentazione; modelli reali, app installata, diritti di distribuzione e perdita di alimentazione conservano gate distinti.
