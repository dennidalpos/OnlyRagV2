# Sanitizer incorporato in Monaco — 20 ottobre 2026

Monaco 0.56.0 contiene DOMPurify 3.4.8 come sorgente incorporato: l'override npm aggiorna la dipendenza installata ma non quei byte. La nuova candidata upstream Monaco 0.57.0, scaricata dal registro ufficiale, contiene ancora 3.4.15 e non risolve gli advisory con patch dichiarata in 3.4.17. Monaco rimane quindi alla versione già qualificata.

DOMPurify **3.4.17** è ora dipendenza di build diretta e override esatto. [`monacoSanitizerPlugin.mts`](../scripts/monacoSanitizerPlugin.mts) sostituisce esclusivamente l'import del sanitizer di Monaco con il modulo ESM corretto; non modifica node_modules. Il build verifica versione e grafo dei moduli e fallisce se rimane il sanitizer incorporato o se Monaco non usa la sostituzione. Un futuro aggiornamento richiede una nuova qualifica della versione fissata. Manifest e lock cambiano soltanto DOMPurify e la sua dichiarazione diretta.

## Percorso e condizioni

L'editor usa i componenti Monaco locali. Il percorso del contenuto Markdown passa da `markdownRenderer.js` a `domSanitize.js`, con allowlist di tag/attributi, hook per URL e rimozione degli hook in finally. Il probe intercetta le configurazioni effettive senza modificarle: output DOM fragment, parser HTML predefinito, `IN_PLACE` e `SAFE_FOR_TEMPLATES` disattivati. Le condizioni specifiche XHTML, hook in-place e template/shadow-root dei tre advisory non sono attivate dai percorsi esercitati. Questo è un confine del chiamante verificato, non un'affermazione generale di assenza di vulnerabilità nella vecchia libreria.

Fonti primarie: [SMIL/XHTML GHSA-c6gr-qvv4-5v3f](https://github.com/cure53/DOMPurify/security/advisories/GHSA-c6gr-qvv4-5v3f), [hook IN_PLACE GHSA-mrv2-3pqr-j5jr](https://github.com/cure53/DOMPurify/security/advisories/GHSA-mrv2-3pqr-j5jr), [template/shadow root GHSA-cg2g-xh64-v4q7](https://github.com/cure53/DOMPurify/security/advisories/GHSA-cg2g-xh64-v4q7), [sorgenti DOMPurify 3.4.17](https://github.com/cure53/DOMPurify/tree/3.4.17), [registro Monaco 0.57.0](https://registry.npmjs.org/monaco-editor/0.57.0).

## Regresso nativo

`npm run test:e2e:monaco-sanitizer` compila i chiamanti Monaco reali con lo stesso plugin e li esegue nel Chromium di Electron 43.7.4, con profilo separato, sandbox, Node disabilitato e richieste HTTP bloccate. Verifica versione effettiva, configurazioni raggiunte, rifiuto di script/handler/URL javascript, SVG/SMIL e template; conserva HTML innocuo, link HTTPS e grassetto Markdown. Il grafo e il codice generato escludono i byte incorporati 3.4.8. La CI eseguirà il controllo prima dei gate completi.

La prova passa dopo `npm ci` dal lock finale: report `C:/Users/Utente/AppData/Local/Temp/onlyrag-monaco-sanitizer-pRslXu/report.json`. Il primo probe con sola verifica comportamentale passava; aggiunta l'intercettazione delle configurazioni, ha rilevato due istanze dovute a path Windows con separatori differenti nel bundle di prova. La risoluzione ora normalizza il path e il probe verifica la stessa istanza realmente chiamata. Fallimenti iniziali e profili sono conservati per revisione.

La build di produzione passa con il controllo dei moduli effettivi; statico e documentazione passano. `DEPENDENCY-MONACO-VENDORED-SANITIZER-01` è concluso e rimosso dal tracker. La suite completa resta riportata nel riepilogo del lotto, distinguendo gli eventuali fallimenti di fixture estranee alla correzione.

La qualifica riguarda bundle sorgente e rendering nativo locale. Installer conservati, resa complessiva dell'editor, qualifica di tutti gli input ostili e diritti di distribuzione mantengono i rispettivi confini. Nessuna app installata, dato personale, chiamata modello o pubblicazione. Licenze DOMPurify MPL-2.0 oppure Apache-2.0; i vecchi inventari restano storici e un nuovo pacchetto deve rigenerare i propri avvisi.

I nuovi probe sono ora conservati sotto `C:/Users/Utente/OnlyRag-Live/tracker-local-fixes-20261020-1de2acbf/fixtures`; la mappa `fixture-location-map.json` registra il trasferimento dai path TEMP riportati sopra e il readback SHA256 di tutti i file. I percorsi nei report originali non vengono riscritti.
