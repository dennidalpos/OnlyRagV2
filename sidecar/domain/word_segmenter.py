import re
from typing import Set

# Core Italian and English vocabulary for OCR word separation
_CORE_VOCABULARY: Set[str] = {
    # Italian functional & common words
    "a", "ad", "agli", "ai", "al", "all", "alla", "alle", "allo", "anche", "ancora", "anni",
    "anno", "appena", "articolo", "art", "assistenza", "attraverso", "avere", "avendo", "avuto",
    "bene", "borgo", "care", "call", "center", "camera", "cap", "casa", "casella", "causa",
    "cessazione", "che", "chi", "chiede", "chiedo", "ci", "ciao", "ciascun", "ciascuno",
    "civico", "cliente", "codice", "cognome", "col", "coi", "come", "comune", "con", "contro",
    "conto", "contratto", "cosa", "cosi", "cui", "customer", "da", "dagli", "dai", "dal",
    "dall", "dalla", "dalle", "dallo", "data", "dati", "dei", "del", "dell", "della",
    "delle", "dello", "detto", "di", "diretto", "direttamente", "diritto", "dispositivo",
    "documento", "dopo", "dove", "dovra", "dovrà", "dovere", "due", "e", "ed",
    "elenco", "email", "e-mail", "entro", "era", "erano", "esclusiva", "escluso", "esempio",
    "esercizio", "essere", "essendo", "stato", "stata", "stati", "state", "europeo", "fa",
    "family", "fatto", "fino", "firenze", "firma", "fiscale", "fornire", "fornite", "forniti",
    "fornito", "fra", "gestione", "gia", "giorno", "gli", "grazie", "ha", "hanno", "ho",
    "i", "il", "in", "inviare", "inviato", "inviata", "inviati", "inviate", "indicare",
    "indicato", "indicata", "indicati", "indicate", "indicazione", "indicazioni", "indirizzo",
    "insieme", "io", "l", "la", "lasciare", "le", "leggibile", "lei", "lettera", "li", "lo",
    "loro", "luogo", "ma", "mail", "mai", "mantova", "me", "medio", "meno", "mentre", "mese",
    "mesi", "mezzo", "mi", "mio", "mia", "miei", "mie", "modulo", "molto", "momento", "mondo",
    "ne", "negli", "nei", "nel", "nell", "nella", "nelle", "nello", "niente", "no", "nome",
    "non", "nostro", "nostra", "nostri", "nostre", "noto", "notte", "nuovo", "nuova", "numero",
    "o", "obbligatori", "obbligatorio", "obbligatoria", "oggi", "ogni", "oltre", "oppure",
    "ora", "ore", "ormai", "oro", "ovvero", "padre", "parte", "parti", "pec", "per", "perche",
    "perché", "percio", "persona", "piu", "più", "poco", "poi", "point", "porta", "posta",
    "postale", "posto", "potere", "poter", "potuto", "primo", "prima", "primi", "prime",
    "presso", "presente", "presenti", "proprio", "prov", "provincia", "punto", "punti",
    "pure", "quale", "quali", "quando", "quanto", "quanta", "quanti", "quante", "quasi",
    "quello", "quella", "quelli", "quelle", "questo", "questa", "questi", "queste", "qui",
    "quindi", "raccomandata", "ragione", "recesso", "recandosi", "rendere", "residenza",
    "richiesta", "richiede", "riconsegnare", "riconsegnato", "riconsegnata", "roma", "s",
    "sa", "salve", "sapere", "saranno", "sara", "sarà", "se", "secondo", "seconda", "seguito",
    "sei", "sempre", "senza", "serafico", "servizio", "servizi", "si", "sia", "sito", "sociale",
    "solo", "soltanto", "sono", "sopra", "sotto", "sottoscritto", "sottoscritta", "spett",
    "spett.le", "spedire", "spedendo", "spedendolo", "spesa", "spese", "spesso", "sta",
    "stanno", "stare", "stesso", "stessa", "stessi", "stesse", "succursale", "su", "sua",
    "sue", "sugli", "sui", "sul", "sull", "sulla", "sulle", "sullo", "suo", "suoi", "tale",
    "tali", "tanto", "telepass", "tempo", "tempi", "terzo", "testo", "ti", "tra", "tramite",
    "tre", "tu", "tuo", "tua", "tuoi", "tue", "tutto", "tutta", "tutti", "tutte", "un",
    "una", "uno", "uomo", "va", "vai", "valore", "vecchio", "vendita", "venuto", "veramente",
    "vero", "vera", "vi", "via", "viadel", "villa", "poma", "vita", "visto", "vista",
    "voci", "voi", "volere", "volta", "volte", "vostro", "vostra", "vostri", "vostre", "web",
    # English functional words
    "about", "above", "across", "after", "again", "against", "all", "almost", "along",
    "already", "also", "although", "always", "among", "an", "and", "another", "any", "anyone",
    "anything", "are", "around", "as", "ask", "at", "back", "be", "because", "become",
    "been", "before", "began", "behind", "being", "below", "between", "both", "but", "by",
    "call", "came", "can", "care", "case", "center", "change", "client", "code", "come",
    "company", "contract", "could", "customer", "data", "date", "day", "did", "do", "does",
    "done", "down", "during", "each", "email", "end", "even", "every", "family", "few",
    "find", "first", "for", "form", "found", "from", "get", "give", "go", "good", "great",
    "had", "has", "have", "he", "her", "here", "him", "his", "how", "if", "in", "into",
    "is", "it", "its", "just", "know", "large", "last", "leave", "left", "let", "like",
    "line", "list", "little", "long", "look", "made", "make", "many", "may", "me", "might",
    "more", "most", "much", "must", "my", "name", "need", "never", "new", "no", "not",
    "now", "number", "of", "off", "old", "on", "once", "one", "only", "or", "other", "our",
    "out", "over", "own", "page", "part", "people", "per", "place", "point", "present",
    "read", "receipt", "request", "return", "right", "said", "same", "say", "see", "send",
    "sent", "service", "set", "she", "should", "side", "signed", "small", "so", "some",
    "such", "take", "tell", "than", "that", "the", "their", "them", "then", "there",
    "these", "they", "thing", "think", "this", "those", "three", "through", "time", "to",
    "too", "two", "under", "undersigned", "until", "up", "upon", "us", "use", "used",
    "very", "via", "want", "was", "water", "way", "we", "well", "went", "were", "what",
    "when", "where", "which", "while", "white", "who", "whom", "will", "with", "without",
    "word", "work", "would", "write", "written", "year", "you", "your"
}

def _viterbi_segment_compound(text: str) -> str:
    """Dynamic programming Viterbi unigram word segmentation for fused OCR Latin text."""
    if len(text) <= 3 or text.lower() in _CORE_VOCABULARY:
        return text

    n = len(text)
    dp = [(float('inf'), -1)] * (n + 1)
    dp[0] = (0, 0)

    for i in range(1, n + 1):
        for j in range(max(0, i - 25), i):
            w = text[j:i].lower()
            if w in _CORE_VOCABULARY:
                # Prefer recognized longer dictionary words
                cost = dp[j][0] + 1.0 / (len(w) ** 1.25)
                if cost < dp[i][0]:
                    dp[i] = (cost, j)
            elif j == i - 1 and dp[j][0] != float('inf'):
                # Single-character fallback penalty
                cost = dp[j][0] + 6.0
                if cost < dp[i][0]:
                    dp[i] = (cost, j)

    if dp[n][0] == float('inf') or dp[n][1] == -1:
        return text

    res = []
    curr = n
    while curr > 0:
        prev = dp[curr][1]
        res.append(text[prev:curr])
        curr = prev

    res.reverse()

    # Guard: if any segment is a single character (other than common Italian/English 1-letter words 'a', 'e', 'i', 'o', 'd'),
    # the segmentation was an unnatural split of an unknown word. Reject and preserve the original text.
    valid_single_letters = {"a", "e", "i", "o", "d"}
    for segment in res:
        if len(segment) == 1 and segment.lower() not in valid_single_letters:
            return text
        if len(segment) > 1 and segment.lower() not in _CORE_VOCABULARY:
            return text

    return " ".join(res)

def normalize_ocr_token_spacing(text: str) -> str:
    """
    Normalizes spacing on OCR text:
    - Splits letters and digits (e.g. Laurentina449 -> Laurentina 449)
    - Splits camelCase / PascalCase (e.g. TelepassFamily -> Telepass Family)
    - Separates punctuation boundaries (e.g. Telepass,recandosi -> Telepass, recandosi)
    - Segments fused lowercase compounds (e.g. conlapresentechiedelacessazionedelcontratto)
    - Preserves emails, URLs, and formatted IDs/Fiscal codes
    """
    if not text or not text.strip():
        return ""

    tokens = text.split()
    cleaned_tokens = []

    for raw_tok in tokens:
        # Preserve emails, URLs, and standard 16-char uppercase fiscal codes verbatim
        if "@" in raw_tok or raw_tok.startswith("http://") or raw_tok.startswith("https://") or (raw_tok.isupper() and len(raw_tok) == 16):
            cleaned_tokens.append(raw_tok)
            continue

        # Normalize intra-token punctuation spacing
        tok = re.sub(r'(?<=[a-zA-Z0-9])([,;:\*])(?=[a-zA-Z0-9])', r'\1 ', raw_tok)
        tok = re.sub(r'(?<=[a-zA-Z])(\/)(?=[a-zA-Z])', r' \1 ', tok)

        # Split digits and letters
        tok = re.sub(r'([a-zA-Z])([0-9])', r'\1 \2', tok)
        tok = re.sub(r'([0-9])([a-zA-Z])', r'\1 \2', tok)

        # Split PascalCase / camelCase
        tok = re.sub(r'([a-z])([A-Z])', r'\1 \2', tok)

        sub_tokens = tok.split()
        for st in sub_tokens:
            # Segment long lowercase run if >= 7 characters and purely alphabetic
            clean_alpha = re.sub(r'[^a-zA-Z]', '', st)
            if len(clean_alpha) >= 7 and clean_alpha.isalpha() and not clean_alpha.isupper():
                cleaned_tokens.append(_viterbi_segment_compound(st))
            else:
                cleaned_tokens.append(st)

    out = " ".join(cleaned_tokens)
    return re.sub(r'\s+', ' ', out).strip()
