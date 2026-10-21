# Traduzione dei documenti

Il Renderer gestisce Markdown e traduzione PDF/DOCX con selezioni separate e un blocco condiviso ([`useTranslation.ts`](../src/hooks/useTranslation.ts)). Il Sidecar esegue la traduzione e il reinserimento tramite [`translator.py`](../sidecar/domain/translator.py); Main valida gli eventi e inoltra la cancellazione.

## Comportamento attuale

- La richiesta richiede un modello esplicito e usa contesto e `think` selezionati. Lo stream segnala progresso, errore o annullamento; una traduzione parziale o rifiutata non è esportabile.
- Per PDF e DOCX l'originale resta invariato. La traduzione protegge contatti completi, valori letterali, identificatori e asterischi con marker verificati; marker mancanti, duplicati o aggiunti causano rifiuto.
- Gli output PDF/DOCX sono salvati e riletti in uno staging separato, poi pubblicati senza sostituzione. Una collisione tardiva fallisce preservando il file esistente; un errore di pulizia indica il percorso recuperabile. Le destinazioni devono supportare hard link. [Regressioni native e limiti](./verification-translation-fixes-2026-10-20.md).
- DOCX include corpo, tabelle annidate, hyperlink e intestazioni/piè di pagina condivisi o distinti, tradotti una sola volta. Campi, textbox, note/commenti, revisioni e altri contenitori testuali non supportati causano rifiuto esplicito prima della traduzione; le immagini sono conservate senza OCR. La resa visiva Word resta da qualificare.
- Il reinserimento PDF controlla glyph, font, modalità e limiti geometrici prima della redazione, poi verifica il testo Unicode dopo il salvataggio. Gli alias CJK usano `ActualText` solo dove necessari.
- Un glossario chiuso copre etichette e clausole complete di moduli italiani riconosciuti; termini diversi tornano al modello e ai controlli ordinari. I contributi del glossario non sono prova della qualità generale del modello.

## Accettazione e limiti

Il corpus congelato di quattro documenti passa **4/4** nella configurazione dichiarata con confronto indipendente completo. Il singolo modulo italiano esaminato passa **8/8** lingue nella configurazione 4B dichiarata. Sono risultati storici circoscritti: non qualificano altri documenti, la resa visiva DOCX o un installer corrente. Stop e unmount PDF/DOCX usano un'identità assegnata prima dell'invio e attendono l'esito IPC, senza scambiare l'accettazione dell'annullamento per la sua conclusione. `TRANSLATION-INPLACE-UNMOUNT-CANCELLATION-01` è [concluso nel perimetro locale del 21 ottobre](./verification-tracker-completion-2026-10-21.md): Stop, unmount, eventi tardivi e perdita di trasporto; 200 regressioni Python comprendono cancellazione di PDF/DOCX reali sintetici con originale e output precedente preservati. Campagne modello e installato restano ritirate dalla fase locale; stato corrente nel [`tracker`](../PROJECT_STATUS.json).

Origini, output, fallimenti storici e revisioni indipendenti: [`translation-language-audit-2026-10-13.md`](./translation-language-audit-2026-10-13.md), [`translation-fidelity-2026-10-01.md`](./translation-fidelity-2026-10-01.md) e [`verification-history-2026-10-13.md`](./verification-history-2026-10-13.md). Non riusare budget o casi live già spesi.
