import os
import json
import re
import ftfy
from typing import Set, Dict, List, Optional, Any
from sidecar.config import logger

_WORDFREQ_AVAILABLE = False
try:
    import wordfreq
    _WORDFREQ_AVAILABLE = True
except ImportError:
    _WORDFREQ_AVAILABLE = False

_SYMSPELL_AVAILABLE = False
try:
    import symspellpy
    from symspellpy import SymSpell
    _SYMSPELL_AVAILABLE = True
except ImportError:
    _SYMSPELL_AVAILABLE = False

# Standard ISO 639-1 two-letter language code normalization map
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
    """Normalizes any language string or code to standard 2-letter ISO 639-1 code (defaults to 'it')."""
    if not lang:
        return "it"
    cleaned = lang.strip().lower().split("_")[0].split("-")[0]
    return _LANG_CODE_MAP.get(cleaned, _LANG_CODE_MAP.get(lang.strip().lower(), "it"))

# Genuine standalone 1-letter words / abbreviations in Latin/European languages (conjunctions, prepositions, articles, pronouns, units)
_VALID_SINGLE_LETTERS: Set[str] = {"a", "e", "i", "o", "u", "y", "d", "n", "c", "v", "p", "s", "l", "m", "g", "k", "h"}


class MultiLangVocabManager:
    """
    Manages multi-language vocabulary word frequencies and SymSpell statistical segmentation engines.
    Integrates wordfreq (45+ languages) with symspellpy and local custom terminology caches.
    """
    def __init__(self, cache_dir: Optional[str] = None):
        if not cache_dir:
            appdata = os.environ.get("APPDATA") or os.path.expanduser("~/.onlyrag_v2")
            self.cache_dir = os.path.join(appdata, "onlyrag-v2", "vocab")
        else:
            self.cache_dir = cache_dir
        self._local_vocab_cache: Dict[str, Dict[str, float]] = {}
        self._symspell_cache: Dict[str, Any] = {}
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
        if not word:
            return 0.0
        w_lower = word.lower()
        norm_lang = normalize_language_code(lang)

        # 1. Check local / dynamic custom vocabulary cache
        if norm_lang in self._local_vocab_cache and w_lower in self._local_vocab_cache[norm_lang]:
            return float(self._local_vocab_cache[norm_lang][w_lower])

        # 2. Check universal wordfreq database
        if _WORDFREQ_AVAILABLE:
            try:
                freq = wordfreq.zipf_frequency(w_lower, norm_lang)
                if norm_lang != "en":
                    en_freq = wordfreq.zipf_frequency(w_lower, "en")
                    if en_freq > freq:
                        freq = en_freq
                return freq
            except Exception:
                pass

        return 0.0

    def is_known_word(self, word: str, lang: str = "it") -> bool:
        """Returns True if word is recognized with significant statistical frequency."""
        return self.get_word_zipf(word, lang) >= 2.0

    def get_symspell_engine(self, lang: str = "it") -> Optional[Any]:
        """Returns a cached SymSpell engine initialized from universal wordfreq corpus for the language."""
        if not _SYMSPELL_AVAILABLE:
            return None
        norm_lang = normalize_language_code(lang)
        if norm_lang in self._symspell_cache:
            return self._symspell_cache[norm_lang]

        try:
            sym = SymSpell(max_dictionary_edit_distance=0, prefix_length=7)
            if _WORDFREQ_AVAILABLE:
                freq_dict = wordfreq.get_frequency_dict(norm_lang)
                for w, freq in freq_dict.items():
                    sym.create_dictionary_entry(w, max(1, int(freq * 1_000_000_000)))
            # Add custom local words if present
            if norm_lang in self._local_vocab_cache:
                for cw, z_score in self._local_vocab_cache[norm_lang].items():
                    sym.create_dictionary_entry(cw, int(10 ** z_score))

            self._symspell_cache[norm_lang] = sym
            return sym
        except Exception as e:
            logger.debug(f"SymSpell engine initialization skipped: {e}")
            return None


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
    """
    Statistical word segmentation using symspellpy word_segmentation powered by wordfreq,
    with automatic casing preservation and DP fallback.
    """
    if len(text) <= 3:
        return text

    norm_lang = normalize_language_code(lang)
    vocab_mgr = get_vocab_manager()

    # If the whole word is a known high-frequency token, don't split
    whole_zipf = vocab_mgr.get_word_zipf(text, norm_lang)
    if whole_zipf >= 2.5:
        return text

    # 1. Primary: SymSpell standard statistical word segmentation
    sym_engine = vocab_mgr.get_symspell_engine(norm_lang)
    if sym_engine is not None:
        try:
            res = sym_engine.word_segmentation(text.lower())
            corrected = (res.corrected_string or "").strip()
            if corrected and " " in corrected:
                words = corrected.split()
                # Verify segmented words
                if len(words) > 1 and all(len(w) > 1 or w in _VALID_SINGLE_LETTERS for w in words):
                    if text.isupper():
                        return corrected.upper()
                    if text[0].isupper():
                        return corrected[0].upper() + corrected[1:]
                    return corrected
        except Exception as e:
            logger.debug(f"SymSpell segmentation error: {e}")

    # 2. Fallback: Dynamic programming Viterbi unigram segmentation
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
            if zipf >= (4.0 if len(sub) == 1 else 2.0):
                cost = dp[j][0] + (8.5 - zipf)
                if cost < dp[i][0]:
                    dp[i] = (cost, j)
            elif j == i - 1 and dp[j][0] != float('inf'):
                cost = dp[j][0] + 12.0
                if cost < dp[i][0]:
                    dp[i] = (cost, j)

    if dp[n][0] == float('inf') or dp[n][1] == -1:
        return text

    res_words: List[str] = []
    curr = n
    while curr > 0:
        prev = dp[curr][1]
        res_words.append(text[prev:curr])
        curr = prev

    res_words.reverse()

    single_letters = [s for s in res_words if len(s) == 1]
    if any(s.lower() not in _VALID_SINGLE_LETTERS for s in single_letters):
        return text
    if len(res_words) > 1 and (len(single_letters) / len(res_words)) > 0.40:
        return text

    for s in res_words:
        if len(s) > 1 and not vocab_mgr.is_known_word(s, norm_lang):
            return text

    if len(res_words) <= 1:
        return text

    out_segments: List[str] = []
    for s in res_words:
        if is_upper:
            out_segments.append(s.upper())
        elif is_title and len(out_segments) == 0:
            out_segments.append(s.capitalize())
        else:
            out_segments.append(s)

    return " ".join(out_segments)


def normalize_ocr_token_spacing(text: str, lang: str = "it") -> str:
    """
    Normalizes spacing on OCR text using standard ftfy and symspellpy libraries:
    - Automatically repairs encoding / mojibake via ftfy
    - Isolates email addresses, URLs, and formatted Italian Fiscal Codes
    - Separates fused TLDs (e.g. .comovvero -> .com ovvero)
    - Separates email keywords (e.g. e-mailgestione -> e-mail gestione)
    - Splits letters and digits (e.g. Laurentina449 -> Laurentina 449)
    - Splits camelCase / PascalCase (e.g. TelepassFamily -> Telepass Family)
    - Segments fused compound words statistically via SymSpell & wordfreq
    """
    if not text or not text.strip():
        return ""

    # 0. Clean unprintable control characters and repair text via ftfy
    try:
        text = ftfy.fix_text(text)
    except Exception:
        pass

    text = text.replace("\xa0", " ").replace("\u00a0", " ").replace("\x00", "").replace("\ufeff", "")
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
    text = re.sub(r'([a-zA-Z]+)(N[°º\.\?])', r'\1 \2', text)
    text = re.sub(r'(?i)\bN[\ufffd°º\.\?\^]*\s*CIVICO\b', 'N° CIVICO', text)
    text = re.sub(r'(?i)\bLOCALIT[\ufffdÀAàa]*\b', 'LOCALITÀ', text)
    text = re.sub(r'(?i)(N[°º\.\?])(?=[0-9A-Z])', r'\1 ', text)

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
