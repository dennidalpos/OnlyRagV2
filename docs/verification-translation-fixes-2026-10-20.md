# Correzioni della traduzione — 20 ottobre 2026

## Pubblicazione esclusiva

`TRANSLATION-OUTPUT-PUBLICATION-01`: la serializzazione PDF/DOCX avviene in una directory temporanea distinta nella destinazione. La rilettura nativa verifica ZIP/DOCX o PDF e numero pagine; un flush precede la creazione esclusiva dell'hard link finale. Il file finale appare completo; una collisione tardiva produce errore senza sostituire byte altrui. Un file già presente prima dell'avvio mantiene il nome originale e il nuovo output usa un suffisso distinto.

Nomi sorgente e suffissi lingua non possono introdurre componenti di percorso. La cancellazione osservata prima della pubblicazione elimina lo staging; la pubblicazione è il punto di completamento. Un errore di pulizia riporta il percorso recuperabile, distinguendo output completo già pubblicato da staging non pubblicato. Non si tenta una copia parziale o una rename sostitutiva se il filesystem rifiuta gli hard link: tali destinazioni ricevono errore.

Le regressioni native in `sidecar/tests/test_translation_output.py` coprono entrambi i formati: collisioni iniziali e tardive, due traduzioni sovrapposte, errore dopo scritture ZIP/PDF reali, output serializzato invalido, cancellazione dopo serializzazione, chiusura del generatore, rifiuto della pubblicazione, rifiuto della pulizia prima/dopo pubblicazione, recupero successivo e input di percorso invalidi. Il trasporto di traduzione è simulato; parsing, salvataggio, rilettura e filesystem sono reali. I 23 nuovi casi passano su Windows con Python 3.13.15, python-docx 1.2.0 e PyMuPDF 1.28.2.

L'iniezione ZIP iniziale ha dimostrato un handle trattenuto dal serializer: ora lo stream è posseduto dal chiamante e chiuso anche su errore. L'apertura nativa di un PDF invalido tratteneva analogamente un handle nel traceback; la validazione usa un mapping e un memoryview con durata esplicita. I diagnostici iniziali restano negli output della sessione e sono descritti qui, non contati come passaggi nei report finali.

La qualifica riguarda i sorgenti e fixture isolate. Non certifica traduzione semantica, resa Word, app installata, filesystem senza hard link o perdita di alimentazione. I rispettivi task restano aperti. Nessun dato personale o modello reale coinvolto.

Riferimenti: [os.link in Python 3.13](https://docs.python.org/3.13/library/os.html#os.link), [salvataggio DOCX 1.2.0](https://python-docx.readthedocs.io/en/latest/api/document.html#docx.document.Document.save), [implementazione PyMuPDF 1.28.2](https://github.com/pymupdf/PyMuPDF/blob/1.28.2/src/__init__.py). La compatibilità di memoryview è verificata anche nei sorgenti 1.28.2 installati.

## Copertura DOCX

`TRANSLATION-DOCX-CONTENT-COVERAGE-01`: visita in ordine XML del corpo e delle parti intestazione/piè di pagina già collegate. Include paragrafi, tabelle annidate, celle unite e hyperlink. Ogni parte condivisa viene tradotta una volta; non sono create intestazioni mancanti tramite l'accesso alle proprietà di sezione.

Prima della traduzione sono rifiutati campi Word, textbox, altChunk/subdocumenti, note e commenti, contenuti controllati, revisioni tracciate, simboli speciali, formule, grafici/diagrammi e parti testuali Word estranee alle storie supportate. Un run che mescola testo e grafica è rifiutato perché assegnare run.text rimuoverebbe la grafica. Le immagini senza testo XML sono preservate: non viene eseguito OCR sulle immagini DOCX. Questa è una copertura dichiarata, non supporto universale OOXML.

I 19 nuovi casi di `sidecar/tests/test_translation_docx_coverage.py` verificano il pacchetto ZIP indipendentemente dal collector: sei varianti di header/footer, sezioni collegate, footer distinto, hyperlink, celle unite, tabelle annidate, ordine, marker e contatti, bold/italic e immagine conservata. Ogni parte fuori dal testo tradotto rimane byte-identica, incluse relazioni e risorse. Rifiuti verificati prima del trasporto; originale e directory finali invariati. Le suite di traduzione congiunte passano **197 test**. Le qualifiche semantiche, visive e installate restano nei rispettivi task.

Revisione finale: due ulteriori regressioni PDF/DOCX qualificano la chiusura del generatore quando il filesystem rifiuta la pulizia. L'errore viene propagato e registrato con percorso recuperabile, senza tentare di emettere un evento su uno stream già chiuso e senza trattenere la registrazione del task. Il reader DOCX di validazione usa anch'esso uno stream posseduto esplicitamente. Totale finale **199 passati**, di cui 25 casi di pubblicazione e 19 di copertura; il precedente 197 è l'esito della fase di chiusura del task.

Riferimenti compatibili con python-docx 1.2.0: [sezioni e parti collegate](https://python-docx.readthedocs.io/en/latest/api/section.html), [testo dei run e formattazione](https://python-docx.readthedocs.io/en/latest/api/text.html#docx.text.run.Run.text), [documenti e limiti delle liste di paragrafi/tabelle](https://python-docx.readthedocs.io/en/latest/api/document.html).
