# Recupero chat e bozze in CI — 18 ottobre 2026

Lotto autorizzato con «procedi» dopo l'analisi del checkout `d8e690717f0e26704127d80b3549d86dceb6f2ef`. Il perimetro è il probe Electron isolato `scripts/e2e/chatDraftRecovery.mjs` e il suo stato di verifica. Nessuna modifica al comportamento applicativo, ai contratti o ai formati persistenti.

## Problema e riproduzione

La [CI del commit iniziale](https://github.com/dennidalpos/OnlyRagV2/actions/runs/39144849431) fallisce nel passo `Verify Chat and Document Draft Recovery`: il click al centro di `.monaco-editor .view-lines` scade dopo 30 secondi perché il canvas `decorationsOverviewRuler` intercetta gli eventi. Coverage e Sidecar successivi sono saltati, non passati. Le precedenti suite locali restano evidenze distinte.

Il probe originale passa sul desktop locale predefinito e nei viewport di prova 1280×720 e 1024×700. Ridimensionando invece la **finestra nativa** a 1024×720 si riproduce lo stesso timeout: viewport 1010×683, `.view-lines` da x=982 a x=1010, larghezza 28; il punto centrale x=996 cade nel canvas largo 14 pixel. Screenshot e JSON geometrici confermano il bersaglio. Questo riproduce il meccanismo del log remoto; risoluzione e DPI esatti del runner non sono disponibili.

## Correzione e criteri locali

- Focus dell'input Monaco con ruolo `textbox`, seguito da un'asserzione sul vero `document.activeElement`, selezione e digitazione da tastiera. Il livello visuale non viene più usato come bersaglio del click.
- Due sequenze complete, ciascuna con profilo temporaneo indipendente: finestra nativa 1024×720 e target desktop 1920×1080. Il comando CI esistente esegue entrambe.
- Restano il controllo del testo renderizzato, checkpoint automatico prima dell'interruzione, risposta recuperata come incompleta, revisione originale `t1`, rifiuto della chiusura su errore filesystem, retry e confronto esatto dopo riavvio. Aggiunto anche il confronto esatto del contenuto della prima bozza salvata.
- La seconda stringa sintetica diventa `# Newer draft`: resta interamente renderizzabile anche nella colonna minima con word wrap. Il confronto del file finale usa esattamente questa stringa; non viene abbreviato un contenuto dell'utente.
- In caso di fallimento si conservano profilo, screenshot e JSON con viewport, focus, geometria dell'editor e bersaglio centrale; la geometria è stampata anche nel log. Un errore di terminazione del processo posseduto non nasconde più l'errore iniziale. Nessuna eliminazione di campagne fallite.

Durante la diagnosi, il click diretto sul textbox non era appropriato: l'input nativo di Monaco sta dietro il livello visuale. Anche il buffer Chromium `EditContext.text` si è mostrato diverso dal testo del modello dopo la digitazione e non viene usato come oracolo. Un'attesa del testo completo falliva quando la stringa lunga era parzialmente virtualizzata; il fixture finale corto conserva il controllo completo del testo e i confronti esatti dei file. Le prove fallite restano nei relativi scratch.

## Verifiche eseguite

| Comando | Esito |
| --- | --- |
| `npm run build` | Passato: TypeScript, Renderer, Main e Preload. |
| `node scripts/e2e/chatDraftRecovery.mjs` | Due esecuzioni finali passate; ciascuna completa entrambi i profili nativi, inclusi interruzione, retry e readback. Viewport locali effettivi 1010×683 e 1906×1043. |
| `npm run test:coverage -- --reporter=dot --silent=true` | 2.890 test passati in 320 file, 218,49 s. Statement 71,91%, branch 62,83%, funzioni 65,71%, righe 73,54%; tutte le soglie superate. |
| `.venv\Scripts\python.exe -B -m pytest -q -rs --tb=short -p no:cacheprovider` | 568 passati, un symlink saltato, 126,42 s. Il caso junction è eseguito. |
| `npm run quality:static` | Passato su 851 file e 103 handler IPC. |
| `npm run docs:check` | Passato su 65 pagine Markdown. |
| `git diff --check` e confronto JSON con HEAD | Passati; schema e tutte le 42 voci precedenti conservati. |

Runtime locali: Node 24.20.0, Electron 43.7.4, Playwright 1.62.1, Monaco 0.56.0, Python 3.13.15. Il runner fallito dichiarava Node 24.19.0. Il funzionamento è verificato sui runtime locali; le API di focus e click sono confrontate con la [documentazione ufficiale Playwright](https://playwright.dev/docs/api/class-locator#locator-focus) e il controllo [Receives Events](https://playwright.dev/docs/actionability#receives-events). La documentazione corrente non qualifica da sola una versione diversa.

## Stato al termine del lotto locale e recupero

`CI-CHAT-DRAFT-RECOVERY-QUALIFICATION-01` resta **aperto** nel tracker esistente. Completamento remoto: run positivo sul commit risultante, con probe chat/bozze e gate coverage/Sidecar successivi tutti eseguiti e passati. Non basta ripetere il run del vecchio commit. Commit e push richiedono autorizzazione separata; non sono stati eseguiti. Tracker: 43 ID univoci, 25 autonomi e 18 con decisione utente; le altre 42 voci restano invariate.

Backup dei file interessati precedente alle modifiche, verificato SHA-256, in `%TEMP%/onlyrag-ci-recovery-ylvvqv5x/backup`; nello stesso scratch si conserva il riproduttore originale strumentato. Riproduzione iniziale fallita conservata in `%TEMP%/onlyrag-chat-drafts-B36xzx`, con `editor-diagnostic.json` e `before-click.png`. Gli ulteriori tentativi diagnostici falliti non sono stati eliminati.

La prova verifica persistenza e recupero meccanici in sviluppo con Renderer/Main/Preload reali e servizi documento/generazione simulati. Non qualifica layout generale alla finestra minima, app installata, modelli reali, semantica o perdita di alimentazione. Il task XLS resta il lavoro offline successivo. Nessuna installazione, migrazione personale o scrittura nei dati dell'utente.

## Qualifica remota conclusa — 19 ottobre 2026

Il [run 39162219398](https://github.com/dennidalpos/OnlyRagV2/actions/runs/39162219398), completato il 18 ottobre e riletto durante la riconciliazione, qualifica il commit risultante `c0cd5a3db3d2bb1bc3bdfe79962ff279a4862792`. GitHub restituisce `success` per il job Windows e per `Verify Chat and Document Draft Recovery (Fail-Fast)`, `Run Coverage Gate (Fail-Fast)` e `Run Sidecar & LanceDB Tests (Fail-Fast)`, tutti eseguiti. Il workflow e il probe del commit includono le sequenze native 1024×720 e 1920×1080.

Soddisfatto il criterio remoto, `CI-CHAT-DRAFT-RECOVERY-QUALIFICATION-01` è rimosso dagli aperti: restano 42 attività, 24 autonome e 18 con decisione utente. Il [run fallito 39144849431](https://github.com/dennidalpos/OnlyRagV2/actions/runs/39144849431) e le prove diagnostiche restano conservati. Le precedenti dichiarazioni di qualifica aperta sono storiche; persistono i limiti su app installata, modelli reali, semantica e perdita di alimentazione.
