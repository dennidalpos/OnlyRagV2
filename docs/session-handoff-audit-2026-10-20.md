# Passaggio di sessione: audit residui — 20 ottobre 2026

Richiesta esplicita del proprietario: salvare il lavoro, aggiornare il tracker, eseguire commit sul branch principale e push per cambio di sessione. Destinazione verificata: repository pubblico [dennidalpos/OnlyRagV2](https://github.com/dennidalpos/OnlyRagV2), branch principale master, base b4703874caf8adc8fbe0a51ee409275f6752c641; fetch iniziale allineato 0/0. La consegna è identificata dal commit contenente questo documento. SHA risultante, conferma push e readback della sua CI saranno registrati nel dossier SecondBrain; il tracker conserva soltanto il lavoro aperto.

## Lavoro salvato

L'[audit del 20 ottobre](./repository-residue-audit-2026-10-20.md), con [ricevuta e matrice JSON](./repository-residue-audit-2026-10-20.json), confronta inventario, sorgenti, test, requisiti e tracker. Nuovi P2 confermati: CI-DEPENDENCY-SCAN-WORKER-DEADLINE-01, TRANSLATION-OUTPUT-PUBLICATION-01 e TRANSLATION-DOCX-CONTENT-COVERAGE-01. Nessuna correzione applicativa implementata. La modifica preesistente alla mappa di conservazione del tracker è preservata.

[PROJECT_STATUS.json](../PROJECT_STATUS.json) conserva **36 attività aperte: 18 autonome / 18 owner-required; 4 P1 / 28 P2 / 4 P3**. Questo passaggio non chiude, duplica, sposta o riprioritizza i record. Le precedenti note di assenza di autorizzazione al commit descrivono la fase di audit, prima di questa richiesta.

## Ripresa

1. Leggere AGENTS, tracker, dossier attivo e stato Git. Rileggere la CI dell'esatto commit di questa consegna. Il [run di base b470387](https://github.com/dennidalpos/OnlyRagV2/actions/runs/39458594764) resta completed/failure sul worker dipendenze: non confonderlo con il timeout retention di f1dd1b7 o con il verde locale. Entrambe le cause restano da diagnosticare nei task esistenti; nessuna asserzione o deadline indebolita.
2. Affrontare i due difetti di traduzione con fixture native offline: pubblicazione esclusiva e gestione dei parziali; visita completa dei contenitori DOCX dichiarati. I tre probe dell'audit usano DOCX reali ma traduzione batch simulata; non sono qualifica del modello, PDF o app installata.
3. Verificare la localizzazione delle prove della sanificazione prima di affidarsi ai candidati conservati: il root TEMP onlyrag-sanitation-20261020-184059-3a743b83 non era disponibile al readback. Causa e altre copie non accertate; non inferire cancellazione o perdita. RETAINED-RESIDUE-DISPOSAL-01 conserva la mappa e i precedenti rifiuti.
4. Qualità live ancora fallita: 5/12 risposte congiunte e 9/11 retrieval globale. Campagna ledger di otto chiamate esaurita: estrazione 1/4 semantica, nessun piano nativo accettato nel limite; niente nuove inferenze ledger senza nuovo budget esplicito. Non cambiare oracoli o marker.
5. Prestazioni RAG: carico/dimensioni/contesa e soglia di latenza ancora da concordare; non assumere approvate le proposte 10k/100k o 2/5 secondi. Restano distinti installazione, dati personali, power-loss, diritti, firma e pubblicazione installer.

## Verifiche della consegna

Verifiche ripetute prima del commit in una nuova copia isolata, con Node 24.20.0, npm 11.19.0, Python 3.13.15 e dipendenze da requirements-dev/constraints senza sostituzioni CPU/GPU:

| Controllo | Esito |
| --- | --- |
| npm run test, reporter JSON | 2.952 passati, 323 file, 214,08 s |
| .venv/Scripts/python.exe -B -m pytest -q -rs --tb=short -p no:cacheprovider | 622 passati, un symlink di directory non disponibile saltato, 173,32 s; junction native eseguite |
| npm run quality:python | 15 passati in 3,71 s, nessun caso mancante o saltato |
| npm run quality:static | 863 file, 107 handler IPC, layering/lint/formato passati |
| npm run typecheck; pip check | Passati |
| npm run docs:check; JSON e git diff --check | Passati sulla consegna; 96 pagine Markdown |
| Corrispondenza copia/sorgenti | 1.170 file fuori dai tre documenti/tracker cambiati: 1.142 identici byte per byte, 28 con sola differenza CRLF/LF; nessuna differenza di contenuto ammessa |
| Dati locali | Tutti i 66 file userdata_dev verificati con SHA256 invariato |

Il checkout principale resta senza node_modules e venv. I risultati Python mancanti nell'audit precedente non sono riscritti: questa e una nuova esecuzione pre-commit con ambiente isolato ricostruito. Le suite usano store e servizi di prova; non qualificano contenuto real-model, desktop installato o perdita di alimentazione. Nessuna nuova build, smoke Electron o installazione per questa consegna soltanto documentale. I problemi CI esistenti restano aperti anche con le suite locali verdi.

## Conservazione

Evidenze sigillate dell'audit: C:/Users/Utente/OnlyRag-Live/repository-residue-audit-20261020-64762349. Non sovrascriverle per questa pubblicazione. Nuovi backup con readback SHA256 e log: C:/Users/Utente/OnlyRag-Live/audit-source-publication-20261020-98bd8cf9.

La revisione automatica ha rifiutato prima dell'esecuzione la rimozione della precedente fixture C:/Users/Utente/AppData/Local/Temp/onlyrag-residue-audit-64762349881147b8b7e3ba7f46273241: blocked by policy, senza ulteriori dettagli. Originale conservato, nessuna cancellazione alternativa; residuo nel task esistente. Nessuna pulizia di dati, profili o prove storiche è autorizzata da questa pubblicazione.


Anche la rimozione della nuova copia pre-commit C:/Users/Utente/AppData/Local/Temp/onlyrag-publication-98bd8cf93fdb42a1965ed71768c60928 e stata rifiutata prima dell'esecuzione: blocked by policy, senza ulteriori dettagli. Fixture originale conservata, nessuna cancellazione alternativa. Log, archivio sorgente, freeze e backup tracker gia copiati con SHA256; manifesto precommit-evidence-manifest.json di 13 file, SHA256 a29419eb7d0c3925eb7ae8a5d5357d8c6afd4317afdf9d4e59e4bf35aa133c912. Residuo aggiunto allo stesso task, senza nuovo ID.
