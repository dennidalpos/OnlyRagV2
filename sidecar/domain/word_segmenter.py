import os
import json
import re
from typing import Set, Dict, List, Optional
from sidecar.config import logger

_WORDFREQ_AVAILABLE = False
try:
    import wordfreq
    _WORDFREQ_AVAILABLE = True
except ImportError:
    _WORDFREQ_AVAILABLE = False

# Mapping from common language names/codes to standard ISO 639-1 two-letter codes
_LANG_CODE_MAP: Dict[str, str] = {
    "italian": "it", "italiano": "it", "it": "it", "ita": "it",
    "english": "en", "inglese": "en", "en": "en", "eng": "en",
    "spanish": "es", "spagnolo": "es", "es": "es", "spa": "es",
    "french": "fr", "francese": "fr", "fr": "fr", "fra": "fr", "fre": "fr",
    "german": "de", "tedesco": "de", "de": "de", "deu": "de", "ger": "de",
    "portuguese": "pt", "portoghese": "pt", "pt": "pt", "por": "pt",
    "dutch": "nl", "olandese": "nl", "nl": "nl", "nld": "nl", "dut": "nl",
    "russian": "ru", "russo": "ru", "ru": "ru", "rus": "ru",
    "chinese": "zh", "cinese": "zh", "zh": "zh", "zho": "zh", "chi": "zh",
    "japanese": "ja", "giapponese": "ja", "ja": "ja", "jpn": "ja",
    "korean": "ko", "coreano": "ko", "ko": "ko", "kor": "ko",
    "arabic": "ar", "arabo": "ar", "ar": "ar", "ara": "ar",
    "polish": "pl", "polacco": "pl", "pl": "pl", "pol": "pl",
}

def normalize_language_code(lang: Optional[str]) -> str:
    """Normalizes any language string/code to standard 2-letter ISO code (defaults to 'it')."""
    if not lang:
        return "it"
    cleaned = lang.strip().lower().split("_")[0].split("-")[0]
    return _LANG_CODE_MAP.get(cleaned, _LANG_CODE_MAP.get(lang.strip().lower(), "it"))

# Core baseline vocabulary fallback
_CORE_VOCABULARY: Set[str] = {
    # Italian functional & common words
    "a", "ad", "agli", "ai", "al", "aldina", "all", "alla", "alle", "allo", "anche", "ancora", "anni",
    "anno", "appena", "articolo", "articoli", "art", "assistenza", "attraverso", "avere", "avendo", "avuto",
    "bene", "borgo", "care", "call", "center", "camera", "cap", "casa", "casella", "causa",
    "carrello", "categorie", "cessazione", "che", "chi", "chiede", "chiedo", "ci", "ciao", "ciascun", "ciascuno",
    "civico", "cliente", "codice", "cognome", "col", "coi", "come", "comune", "con", "consegna", "contro",
    "conto", "contratto", "cosa", "cosi", "così", "cui", "customer", "da", "dagli", "dai", "dal",
    "dall", "dalla", "dalle", "dallo", "data", "dati", "dei", "del", "dell", "della",
    "delle", "dello", "detto", "di", "diretto", "direttamente", "diritto", "dispositivo",
    "disponibile", "disponibili", "disattivazione", "decorrenza", "dichiara", "documento",
    "dopo", "dove", "dovra", "dovrà", "dovrd", "dovere", "due", "e", "ed", "elenco",
    "email", "e-mail", "entro", "era", "erano", "esclusiva", "escluso", "esempio",
    "esercizio", "essere", "essendo", "stato", "stata", "stati", "state", "europeo", "europea",
    "fa", "family", "fatto", "fino", "firenze", "firma", "fiscale", "fornire", "fornite", "forniti",
    "fornito", "fra", "gestione", "gestionecontratto", "gia", "già", "giorno", "giorni", "gli", "grazie", "ha", "hanno", "ho",
    "i", "il", "in", "inviare", "inviato", "inviata", "inviati", "inviate", "indicare",
    "indicato", "indicata", "indicati", "indicate", "indicazione", "indicazioni", "indirizzo",
    "insieme", "intesa", "intestatario", "io", "l", "la", "lasciare", "laurentina", "le", "leggibile", "lei", "lettera", "li", "lo", "loc",
    "localita", "località", "loro", "luogo", "ma", "mail", "mai", "mantova", "mantovano", "me",
    "medio", "meno", "mentre", "mese", "mesi", "mezzo", "mi", "mio", "mia", "miei", "mie",
    "modulo", "molto", "momento", "mondo", "n", "ne", "negli", "nei", "nel", "nell", "nella", "nelle", "nello",
    "nascita", "niente", "no", "nome", "non", "nord", "nostro", "nostra", "nostri", "nostre", "noto", "notte",
    "nuovo", "nuova", "numero", "o", "obbligatori", "obbligatorio", "obbligatoria", "oggi", "ogni",
    "oltre", "oppure", "ora", "ordini", "ore", "ormai", "oro", "ovvero", "padre", "parte", "parti", "pec", "per",
    "perche", "perché", "percio", "perciò", "persona", "pinotti", "piu", "più", "piazza", "poco", "poi", "point", "poma", "porta", "posta", "postale", "posto", "potere", "poter",
    "potuto", "primo", "prima", "primi", "prime", "presso", "presente", "presenti", "proprio",
    "prospetto", "protocollo", "prov", "provincia", "provvisorio", "punto", "punti", "pure", "quale", "quali",
    "quando", "quanto", "quanta", "quanti", "quante", "quasi", "quello", "quella", "quelli",
    "quelle", "questo", "questa", "questi", "queste", "quietanza", "qui", "quindi", "raccomandata",
    "ragione", "recesso", "recandosi", "rendere", "residenza", "residente", "relativo", "relativa",
    "ricevuta", "riconsegnare", "riconsegnato", "riconsegnata", "richiesta", "richiede", "roma", "s", "sa",
    "salve", "sapere", "saranno", "sara", "sarà", "se", "secondo", "seconda", "seguito", "sei", "serafico",
    "sempre", "senza", "servizio", "servizi", "si", "sia", "sito", "sociale", "societa", "società",
    "solo", "soltanto", "sono", "sopra", "sotto", "sottoscritto", "sottoscritta", "spa", "spett",
    "spett.le", "spettabile", "spedire", "spedendo", "spedendolo", "spedizione", "spesa", "spese", "spesso", "sta", "stanno",
    "stare", "stesso", "stessa", "stessi", "stesse", "succursale", "su", "sua", "sue", "sugli",
    "sui", "sul", "sull", "sulla", "sulle", "sullo", "sud", "suo", "suoi", "tale", "tali", "tanto",
    "tariffa", "telepass", "tempo", "tempi", "terzo", "testo", "ti", "titolare", "totale", "tra", "tramite", "trattamento",
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
    "said", "same", "say", "scanned", "see", "send", "sent", "service", "set", "she",
    "should", "side", "signed", "small", "so", "some", "such", "take", "tell", "than",
    "that", "the", "their", "them", "then", "there", "these", "they", "thing", "think",
    "this", "those", "three", "through", "time", "to", "too", "total", "totals", "two",
    "under", "undersigned", "until", "up", "upon", "us", "use", "used", "invoice", "item",
    "very", "via", "want", "was", "water", "way", "we", "well", "went", "were", "what",
    "when", "where", "which", "while", "white", "who", "whom", "will", "with", "without",
    "word", "work", "would", "write", "written", "year", "you", "your"
}

_VALID_SINGLE_LETTERS: Set[str] = {"a", "e", "i", "o", "d", "n", "u", "y"}

class MultiLangVocabManager:
    """
    Manages multi-language vocabulary word frequencies and unigram probabilities.
    Integrates wordfreq (45+ languages), local AppData/assets cached dictionaries,
    and built-in administrative / form domain terms.
    """
    def __init__(self, cache_dir: Optional[str] = None):
        if not cache_dir:
            appdata = os.environ.get("APPDATA") or os.path.expanduser("~/.onlyrag_v2")
            self.cache_dir = os.path.join(appdata, "onlyrag-v2", "vocab")
        else:
            self.cache_dir = cache_dir
        self._local_vocab_cache: Dict[str, Dict[str, float]] = {}
        self._load_cached_vocabularies()

    def _load_cached_vocabularies(self) -> None:
        if not os.path.exists(self.cache_dir):
            return
        try:
            for fname in os.listdir(self.cache_dir):
                if fname.endswith(".json"):
                    lang = fname[:-5].lower()
                    fpath = os.path.join(self.cache_dir, fname)
                    with open(fpath, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        if isinstance(data, dict):
                            self._local_vocab_cache[lang] = {k.lower(): float(v) for k, v in data.items() if not k.startswith("__")}
                        elif isinstance(data, list):
                            self._local_vocab_cache[lang] = {w.lower(): 5.0 for w in data}
        except Exception as e:
            logger.warning(f"Error loading custom vocabularies from {self.cache_dir}: {e}")

    def get_word_zipf(self, word: str, lang: str = "it") -> float:
        """Returns the Zipf frequency (0.0 to 8.0) of a word in the specified language."""
        w_lower = word.lower()
        norm_lang = normalize_language_code(lang)

        # 1. Check local / synced cache
        if norm_lang in self._local_vocab_cache and w_lower in self._local_vocab_cache[norm_lang]:
            return float(self._local_vocab_cache[norm_lang][w_lower])

        # 2. Check wordfreq if available
        if _WORDFREQ_AVAILABLE:
            try:
                freq = wordfreq.zipf_frequency(w_lower, norm_lang)
                if freq > 0:
                    return freq
            except Exception:
                pass

        # 3. Check built-in core vocabulary fallback
        if w_lower in _CORE_VOCABULARY:
            return 5.5

        return 0.0

    def is_known_word(self, word: str, lang: str = "it") -> bool:
        """Returns True if word is recognized in the specified language."""
        return self.get_word_zipf(word, lang) >= 1.0 or word.lower() in _CORE_VOCABULARY

_VOCAB_MANAGER: Optional[MultiLangVocabManager] = None

def get_vocab_manager() -> MultiLangVocabManager:
    global _VOCAB_MANAGER
    if _VOCAB_MANAGER is None:
        _VOCAB_MANAGER = MultiLangVocabManager()
    return _VOCAB_MANAGER

def _is_italian_fiscal_code(token: str) -> bool:
    """Checks if token is a standard 16-character Italian Fiscal Code (Codice Fiscale)."""
    return bool(re.match(r'^[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]$', token))

def _viterbi_segment_compound(text: str, lang: str = "it") -> str:
    """Dynamic programming Viterbi unigram word segmentation for fused OCR Latin text using Zipf frequency."""
    if len(text) <= 3:
        return text

    norm_lang = normalize_language_code(lang)
    vocab_mgr = get_vocab_manager()

    if vocab_mgr.is_known_word(text, norm_lang):
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
            zipf = vocab_mgr.get_word_zipf(sub, norm_lang)
            if zipf > 0:
                if len(sub) == 1:
                    cost = dp[j][0] + (3.5 if sub in _VALID_SINGLE_LETTERS else 7.0)
                else:
                    cost = dp[j][0] + max(0.5, (8.5 - zipf) / (len(sub) ** 0.5))
                if cost < dp[i][0]:
                    dp[i] = (cost, j)
            elif j == i - 1 and dp[j][0] != float('inf'):
                cost = dp[j][0] + 9.0
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

    # Guard 1: single-letter segments must all be valid single words and constitute <= 40% of total segments
    single_letters = [s for s in res if len(s) == 1]
    if any(s.lower() not in _VALID_SINGLE_LETTERS for s in single_letters):
        return text
    if len(res) > 1 and (len(single_letters) / len(res)) > 0.40:
        return text

    # Guard 2: Every multi-letter segment must be a recognized vocabulary word
    for s in res:
        if len(s) > 1 and not vocab_mgr.is_known_word(s, norm_lang):
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

def normalize_ocr_token_spacing(text: str, lang: str = "it") -> str:
    """
    Normalizes spacing on OCR text:
    - Isolates email addresses and URLs
    - Separates fused TLDs (e.g. .comovvero -> .com ovvero)
    - Separates email keywords (e.g. e-mailgestione -> e-mail gestione)
    - Splits letters and digits (e.g. Laurentina449 -> Laurentina 449)
    - Splits camelCase / PascalCase (e.g. TelepassFamily -> Telepass Family)
    - Separates punctuation and symbol boundaries (e.g. Telepass,recandosi -> Telepass, recandosi, CODICEFISCALE* -> CODICE FISCALE *)
    - Segments fused lowercase and uppercase compounds across multiple languages
    - Preserves emails, URLs, and formatted 16-char Italian Fiscal Codes
    """
    if not text or not text.strip():
        return ""

    # 0. Clean unprintable control characters, replacement chars, and non-breaking spaces
    text = text.replace("\xa0", " ").replace("\u00a0", " ").replace("\x00", "").replace("\ufeff", "").replace("\ufffd", "")
    text = re.sub(r'[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]', '', text)

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
    text = re.sub(r'(?i)(N[°º\.\?]\s*CIVICO)', r'N° CIVICO', text)
    text = re.sub(r'(?i)(N[°º\.\?])(?=[0-9A-Z])', r'\1 ', text)

    # Pre-separate common fused prepositions & phrases
    text = re.sub(r'(?i)\b(aseguito)\b', 'a seguito', text)
    text = re.sub(r'(?i)\b(conla)\b', 'con la', text)
    text = re.sub(r'(?i)\b(presentechiede)\b', 'presente chiede', text)
    text = re.sub(r'(?i)\b(lacessazione)\b', 'la cessazione', text)
    text = re.sub(r'(?i)\b(delcontratto)\b', 'del contratto', text)
    text = re.sub(r'(?i)\b(sopraindicato)\b', 'sopra indicato', text)
    text = re.sub(r'(?i)\b(oppurespedendolo)\b', 'oppure spedendolo', text)
    text = re.sub(r'(?i)\b(conraccomandata)\b', 'con raccomandata', text)
    text = re.sub(r'(?i)\b(viadel)\b', 'via del', text)
    text = re.sub(r'(?i)\b(deldiritto)\b', 'del diritto', text)
    text = re.sub(r'(?i)\b(direcesso)\b', 'di recesso', text)
    text = re.sub(r'(?i)\b(dovrd)\b', 'dovrà', text)
    text = re.sub(r'(?i)\b(we\s+be)\b', 'web e', text)
    text = re.sub(r'(?i)\b(Lo\s+C\.)\b', 'Loc.', text)
    text = re.sub(r'(?i)\b(telass)\b', 'Telepass', text)
    text = re.sub(r'(?i)\b(cagnome)\b', 'cognome', text)

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
    text = re.sub(r'(?<=[a-zA-Z°º])([0-9]+)', r' \1', text)
    text = re.sub(r'(?<=[0-9])([a-zA-Z]+)', r' \1', text)

    # 6. Split PascalCase / camelCase
    text = re.sub(r'([a-z])([A-Z])', r'\1 \2', text)
    text = re.sub(r'([A-Z]{2,})([A-Z][a-z])', r'\1 \2', text)

    # 7. De-fragment sequences of isolated uppercase 1-2 letter chunks (e.g. "MA N TO VA NO" -> "MANTOVANO")
    def _defragment_spaced_letters(s: str) -> str:
        pattern = r'\b([A-Za-z]{1,2}(?:\s+[A-Za-z]{1,2}){2,})\b'
        def _merge(m: re.Match) -> str:
            raw_seq = m.group(0)
            parts = raw_seq.split()
            if all(len(p) <= 2 for p in parts):
                merged = "".join(parts)
                if len(merged) >= 4:
                    return merged
            return raw_seq
        return re.sub(pattern, _merge, s)

    text = _defragment_spaced_letters(text)

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

        # Handle compounds containing apostrophes (e.g. Aseguitodell'eserciziodeldirittodirecessodal)
        if "'" in raw_tok:
            sub_parts = raw_tok.split("'")
            seg_parts = []
            for sp in sub_parts:
                match_sp = re.match(r'^([^a-zA-Z0-9]*)(.*?)([^a-zA-Z0-9]*)$', sp)
                if match_sp:
                    spre, score, spost = match_sp.groups()
                    if len(score) >= 5 and score.isalpha():
                        seg_parts.append(f"{spre}{_viterbi_segment_compound(score, lang=lang)}{spost}")
                    else:
                        seg_parts.append(sp)
                else:
                    seg_parts.append(sp)
            cleaned_tokens.append("'".join(seg_parts))
            continue

        # Extract leading and trailing punctuation
        match = re.match(r'^([^a-zA-Z0-9]*)(.*?)([^a-zA-Z0-9]*)$', raw_tok)
        if match:
            pre, core, post = match.groups()
            if len(core) >= 5 and core.isalpha():
                seg = _viterbi_segment_compound(core, lang=lang)
                cleaned_tokens.append(f"{pre}{seg}{post}")
            else:
                cleaned_tokens.append(raw_tok)
        else:
            cleaned_tokens.append(raw_tok)

    out = " ".join(cleaned_tokens)
    for idx, prot_val in enumerate(protected):
        out = out.replace(f"__PROT_TOK_{idx}__", prot_val)

    return re.sub(r'\s+', ' ', out).strip()
