import re
from typing import Set, List

# Core Italian and English vocabulary for OCR word separation
_CORE_VOCABULARY: Set[str] = {
    # Italian functional & common words
    "a", "ad", "agli", "ai", "al", "all", "alla", "alle", "allo", "anche", "ancora", "anni",
    "anno", "appena", "articolo", "art", "assistenza", "attraverso", "avere", "avendo", "avuto",
    "bene", "borgo", "care", "call", "center", "camera", "cap", "casa", "casella", "causa",
    "cessazione", "che", "chi", "chiede", "chiedo", "ci", "ciao", "ciascun", "ciascuno",
    "civico", "cliente", "codice", "cognome", "col", "coi", "come", "comune", "con", "contro",
    "conto", "contratto", "cosa", "cosi", "così", "cui", "customer", "da", "dagli", "dai", "dal",
    "dall", "dalla", "dalle", "dallo", "data", "dati", "dei", "del", "dell", "della",
    "delle", "dello", "detto", "di", "diretto", "direttamente", "diritto", "dispositivo",
    "disponibile", "disponibili", "disattivazione", "decorrenza", "dichiara", "documento",
    "dopo", "dove", "dovra", "dovrà", "dovrd", "dovere", "due", "e", "ed", "elenco",
    "email", "e-mail", "entro", "era", "erano", "esclusiva", "escluso", "esempio",
    "esercizio", "essere", "essendo", "stato", "stata", "stati", "state", "europeo", "europea",
    "fa", "family", "fatto", "fino", "firenze", "firma", "fiscale", "fornire", "fornite", "forniti",
    "fornito", "fra", "gestione", "gia", "già", "giorno", "giorni", "gli", "grazie", "ha", "hanno", "ho",
    "i", "il", "in", "inviare", "inviato", "inviata", "inviati", "inviate", "indicare",
    "indicato", "indicata", "indicati", "indicate", "indicazione", "indicazioni", "indirizzo",
    "insieme", "intesa", "io", "l", "la", "lasciare", "le", "leggibile", "lei", "lettera", "li", "lo",
    "localita", "località", "loro", "luogo", "ma", "mail", "mai", "me",
    "medio", "meno", "mentre", "mese", "mesi", "mezzo", "mi", "mio", "mia", "miei", "mie",
    "modulo", "molto", "momento", "mondo", "n", "ne", "negli", "nei", "nel", "nell", "nella", "nelle", "nello",
    "niente", "no", "nome", "non", "nord", "nostro", "nostra", "nostri", "nostre", "noto", "notte",
    "nuovo", "nuova", "numero", "o", "obbligatori", "obbligatorio", "obbligatoria", "oggi", "ogni",
    "oltre", "oppure", "ora", "ore", "ormai", "oro", "ovvero", "padre", "parte", "parti", "pec", "per",
    "perche", "perché", "percio", "perciò", "persona", "piu", "più", "piazza", "poco", "poi", "point", "porta", "posta", "postale", "posto", "potere", "poter",
    "potuto", "primo", "prima", "primi", "prime", "presso", "presente", "presenti", "proprio",
    "prospetto", "protocollo", "prov", "provincia", "punto", "punti", "pure", "quale", "quali",
    "quando", "quanto", "quanta", "quanti", "quante", "quasi", "quello", "quella", "quelli",
    "quelle", "questo", "questa", "questi", "queste", "quietanza", "qui", "quindi", "raccomandata",
    "ragione", "recesso", "recandosi", "rendere", "residenza", "residente", "relativo", "relativa",
    "ricevuta", "riconsegnare", "riconsegnato", "riconsegnata", "richiesta", "richiede", "roma", "s", "sa",
    "salve", "sapere", "saranno", "sara", "sarà", "se", "secondo", "seconda", "seguito", "sei",
    "sempre", "senza", "servizio", "servizi", "si", "sia", "sito", "sociale", "societa", "società",
    "solo", "soltanto", "sono", "sopra", "sotto", "sottoscritto", "sottoscritta", "spa", "spett",
    "spett.le", "spedire", "spedendo", "spedendolo", "spesa", "spese", "spesso", "sta", "stanno",
    "stare", "stesso", "stessa", "stessi", "stesse", "succursale", "su", "sua", "sue", "sugli",
    "sui", "sul", "sull", "sulla", "sulle", "sullo", "sud", "suo", "suoi", "tale", "tali", "tanto",
    "tariffa", "tempo", "tempi", "terzo", "testo", "ti", "titolare", "tra", "tramite", "trattamento",
    "tre", "tu", "tuo", "tua", "tuoi", "tue", "tutto", "tutta", "tutti", "tutte", "un", "una", "uno",
    "unitamente", "uomo", "utente", "va", "vai", "valore", "vecchio", "vendita", "venuto", "veramente",
    "vero", "vera", "versamento", "vi", "via", "viadel", "villa", "vita", "visto", "vista", "voci",
    "voi", "volere", "volta", "volte", "vostro", "vostra", "vostri", "vostre", "web",
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

_VALID_SINGLE_LETTERS: Set[str] = {"a", "e", "i", "o", "d", "n"}

def _is_italian_fiscal_code(token: str) -> bool:
    """Checks if token is a standard 16-character Italian Fiscal Code (Codice Fiscale)."""
    return bool(re.match(r'^[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]$', token))

def _viterbi_segment_compound(text: str) -> str:
    """Dynamic programming Viterbi unigram word segmentation for fused OCR Latin text."""
    if len(text) <= 3 or text.lower() in _CORE_VOCABULARY:
        return text

    is_upper = text.isupper()
    is_title = text.istitle()
    n = len(text)
    dp = [(float('inf'), -1)] * (n + 1)
    dp[0] = (0, 0)
    w_lower = text.lower()

    for i in range(1, n + 1):
        for j in range(max(0, i - 25), i):
            sub = w_lower[j:i]
            if sub in _CORE_VOCABULARY:
                if len(sub) == 1:
                    cost = dp[j][0] + 4.5
                else:
                    cost = dp[j][0] + 1.0 / (len(sub) ** 1.3)
                if cost < dp[i][0]:
                    dp[i] = (cost, j)
            elif j == i - 1 and dp[j][0] != float('inf'):
                cost = dp[j][0] + 8.0
                if cost < dp[i][0]:
                    dp[i] = (cost, j)

    if dp[n][0] == float('inf') or dp[n][1] == -1:
        return text

    res: List[str] = []
    curr = n
    while curr > 0:
        prev = dp[curr][1]
        res.append(text[prev:curr])
        curr = prev

    res.reverse()

    # Guard 1: single-letter segments must all be valid single words and constitute <= 35% of total segments
    single_letters = [s for s in res if len(s) == 1]
    if any(s.lower() not in _VALID_SINGLE_LETTERS for s in single_letters):
        return text
    if len(res) > 1 and (len(single_letters) / len(res)) > 0.35:
        return text

    # Guard 2: Every multi-letter segment must be a recognized vocabulary word
    for s in res:
        if len(s) > 1 and s.lower() not in _CORE_VOCABULARY:
            return text

    if len(res) <= 1:
        return text

    out_segments: List[str] = []
    for s in res:
        if is_upper:
            out_segments.append(s.upper())
        elif is_title and len(out_segments) == 0:
            out_segments.append(s.capitalize())
        else:
            out_segments.append(s)

    return " ".join(out_segments)

def normalize_ocr_token_spacing(text: str) -> str:
    """
    Normalizes spacing on OCR text:
    - Isolates email addresses and URLs
    - Separates fused TLDs (e.g. .comovvero -> .com ovvero)
    - Separates email keywords (e.g. e-mailgestione -> e-mail gestione)
    - Splits letters and digits (e.g. Laurentina449 -> Laurentina 449)
    - Splits camelCase / PascalCase (e.g. TelepassFamily -> Telepass Family)
    - Separates punctuation and symbol boundaries (e.g. Telepass,recandosi -> Telepass, recandosi, CODICEFISCALE* -> CODICE FISCALE *)
    - Segments fused lowercase and uppercase compounds (e.g. CODICEFISCALE, conlapresentechiedelacessazionedelcontratto)
    - Preserves emails, URLs, and formatted 16-char Italian Fiscal Codes
    """
    if not text or not text.strip():
        return ""

    # 1. Pre-separate common domain TLDs when fused with trailing words
    text = re.sub(
        r'(\.(?:info|tech|biz|com|net|org|gov|edu|eu|it|io|me|ai|co))([a-zA-Z]{2,})',
        r'\1 \2',
        text,
        flags=re.IGNORECASE
    )

    # 2. Pre-separate email prefixes, company forms, and trailing abbreviations when fused
    text = re.sub(r'(?i)(e-mail|email|casella|indirizzo|pec)(?=[a-zA-Z0-9])', r' \1 ', text)
    text = re.sub(r'(?i)([a-zA-Z]+)(e-mail|email)', r'\1 \2', text)
    text = re.sub(r'([a-zA-Z]+)(S\.p\.A\.|Spa|S\.r\.l\.|Srl)', r'\1 \2', text, flags=re.IGNORECASE)
    text = re.sub(r'(S\.p\.A\.|Spa|S\.r\.l\.|Srl)([a-zA-Z]+)', r'\1 \2', text, flags=re.IGNORECASE)
    text = re.sub(r'([a-zA-Z]+)(a\.r\.|c\.a\.|c\.p\.)', r'\1 \2', text, flags=re.IGNORECASE)

    # Normalize N° / n° / N. civico and similar form labels
    text = re.sub(r'(?i)(N[°\.\?]\s*CIVICO)', r'N° CIVICO', text)
    text = re.sub(r'(?i)(N[°\.\?])(?=[0-9A-Z])', r'\1 ', text)

    # 3. Protect complete URLs, emails, and Italian Fiscal Codes using placeholders
    protected: List[str] = []
    def _protect_token(m: re.Match) -> str:
        idx = len(protected)
        protected.append(m.group(0))
        return f" __PROT_TOK_{idx}__ "

    text = re.sub(r'https?://[^\s,;]+', _protect_token, text)
    text = re.sub(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}', _protect_token, text)
    text = re.sub(r'\b[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]\b', _protect_token, text)

    # 4. Separate asterisks and symbols
    text = re.sub(r'(\*+)', r' \1 ', text)
    text = re.sub(r'([,;:\?!])', r'\1 ', text)
    text = re.sub(r'(?<=[a-zA-Z])(\/)(?=[a-zA-Z])', r' \1 ', text)

    # 5. Split digits and letters (excluding protected tokens and degree symbols)
    text = re.sub(r'(?<=[a-zA-Z°])([0-9]+)', r' \1', text)
    text = re.sub(r'(?<=[0-9])([a-zA-Z]+)', r' \1', text)

    # 6. Split PascalCase / camelCase
    text = re.sub(r'([a-z])([A-Z])', r'\1 \2', text)
    text = re.sub(r'([A-Z]{2,})([A-Z][a-z])', r'\1 \2', text)

    tokens = text.split()
    cleaned_tokens: List[str] = []

    for raw_tok in tokens:
        # Check for placeholder
        if raw_tok.startswith("__PROT_TOK_") and raw_tok.endswith("__"):
            try:
                prot_idx = int(raw_tok[len("__PROT_TOK_"):-2])
                cleaned_tokens.append(protected[prot_idx])
                continue
            except (ValueError, IndexError):
                pass

        # Extract leading and trailing punctuation
        match = re.match(r'^([^a-zA-Z0-9]*)(.*?)([^a-zA-Z0-9]*)$', raw_tok)
        if match:
            pre, core, post = match.groups()
            if len(core) >= 5 and core.isalpha():
                seg = _viterbi_segment_compound(core)
                cleaned_tokens.append(f"{pre}{seg}{post}")
            else:
                cleaned_tokens.append(raw_tok)
        else:
            cleaned_tokens.append(raw_tok)

    out = " ".join(cleaned_tokens)
    for idx, prot_val in enumerate(protected):
        out = out.replace(f"__PROT_TOK_{idx}__", prot_val)

    return re.sub(r'\s+', ' ', out).strip()
