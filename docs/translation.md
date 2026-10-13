# Traduzione dei documenti

Il Renderer gestisce Markdown e traduzione PDF/DOCX con selezioni separate e un blocco condiviso ([`useTranslation.ts`](../src/hooks/useTranslation.ts)). Il Sidecar esegue la traduzione e il reinserimento tramite [`translator.py`](../sidecar/domain/translator.py); Main valida gli eventi e inoltra la cancellazione.

## Comportamento attuale

- La richiesta richiede un modello esplicito e usa contesto e `think` selezionati. Lo stream segnala progresso, errore o annullamento; una traduzione parziale o rifiutata non è esportabile.
- Per PDF e DOCX l'originale resta invariato. La traduzione protegge contatti completi, valori letterali, identificatori e asterischi con marker verificati; marker mancanti, duplicati o aggiunti causano rifiuto.
- Il reinserimento PDF controlla glyph, font, modalità e limiti geometrici prima della redazione, poi verifica il testo Unicode dopo il salvataggio. Gli alias CJK usano `ActualText` solo dove necessari.
- Un glossario chiuso copre etichette e clausole complete di moduli italiani riconosciuti; termini diversi tornano al modello e ai controlli ordinari. I contributi del glossario non sono prova della qualità generale del modello.

## Accettazione e limiti

Il corpus congelato di quattro documenti passa **4/4** nella configurazione dichiarata con confronto indipendente completo. Il singolo modulo italiano esaminato passa **8/8** lingue nella configurazione 4B dichiarata. Sono risultati circoscritti: rimangono aperti la fedeltà su altri documenti, la resa visiva DOCX e la verifica della versione installata e riavviata. Il job PDF/DOCX già inviato al Sidecar può inoltre sopravvivere all'unmount prima del primo evento di progresso (`TRANSLATION-INPLACE-UNMOUNT-CANCELLATION-01`). Stato e confini sono nel [`tracker`](../PROJECT_STATUS.json).

Origini, output, fallimenti storici e revisioni indipendenti: [`translation-language-audit-2026-10-13.md`](./translation-language-audit-2026-10-13.md), [`translation-fidelity-2026-10-01.md`](./translation-fidelity-2026-10-01.md) e [`verification-history-2026-10-13.md`](./verification-history-2026-10-13.md). Non riusare budget o casi live già spesi.
