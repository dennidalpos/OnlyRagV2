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

# ISO 639-1 aliases.
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
    """Return an ISO 639-1 code, defaulting to Italian."""
    if not lang:
        return "it"
    cleaned = lang.strip().lower().split("_")[0].split("-")[0]
    return _LANG_CODE_MAP.get(cleaned, _LANG_CODE_MAP.get(lang.strip().lower(), "it"))

# Accepted standalone one-letter tokens.
_VALID_SINGLE_LETTERS: Set[str] = {"a", "e", "i", "o", "u", "y", "d", "n", "c", "v", "p", "s", "l", "m", "g", "k", "h"}


class MultiLangVocabManager:
    """Manage word-frequency, SymSpell, and local vocabulary caches."""
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
        """Return a word's Zipf frequency."""
        if not word:
            return 0.0
        w_lower = word.lower()
        norm_lang = normalize_language_code(lang)

        # Prefer custom vocabulary.
        if norm_lang in self._local_vocab_cache and w_lower in self._local_vocab_cache[norm_lang]:
            return float(self._local_vocab_cache[norm_lang][w_lower])

        # Fall back to wordfreq.
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
        """Return whether a word has meaningful frequency."""
        return self.get_word_zipf(word, lang) >= 2.0

    def get_symspell_engine(self, lang: str = "it") -> Optional[Any]:
        """Return the cached SymSpell engine for a language."""
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
            # Merge custom terms.
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
    """Return whether a token is an Italian fiscal code."""
    return bool(re.match(r'^[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]$', token))


def _viterbi_segment_compound(text: str, lang: str = "it") -> str:
    """Segment a compound with SymSpell, then Viterbi while preserving casing."""
    if len(text) <= 3:
        return text

    norm_lang = normalize_language_code(lang)
    vocab_mgr = get_vocab_manager()

    # Keep known words intact.
    whole_zipf = vocab_mgr.get_word_zipf(text, norm_lang)
    if whole_zipf >= 2.5:
        return text

    # Try SymSpell first.
    sym_engine = vocab_mgr.get_symspell_engine(norm_lang)
    if sym_engine is not None:
        try:
            res = sym_engine.word_segmentation(text.lower())
            corrected = (res.corrected_string or "").strip()
            if corrected and " " in corrected:
                words = corrected.split()
                # Reject implausible segments.
                if len(words) > 1 and all(len(w) > 1 or w in _VALID_SINGLE_LETTERS for w in words):
                    if text.isupper():
                        return corrected.upper()
                    if text[0].isupper():
                        return corrected[0].upper() + corrected[1:]
                    return corrected
        except Exception as e:
            logger.debug(f"SymSpell segmentation error: {e}")

    # Fall back to Viterbi.
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
    """Normalize OCR spacing while preserving protected tokens and casing."""
    if not text or not text.strip():
        return ""

    # Repair encoding and strip controls.
    try:
        text = ftfy.fix_text(text)
    except Exception:
        pass

    text = text.replace("\xa0", " ").replace("\u00a0", " ").replace("\x00", "").replace("\ufeff", "")
    text = re.sub(r'[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]', '', text)

    # Separate fused TLDs.
    text = re.sub(
        r'(\.(?:info|tech|biz|com|net|org|gov|edu|eu|it|io|me|ai|co))([a-zA-Z]{2,})',
        r'\1 \2',
        text,
        flags=re.IGNORECASE
    )

    # Separate common fused abbreviations.
    text = re.sub(r'(?i)(e-mail|email|casella|indirizzo|pec)(?=[a-zA-Z0-9])', r' \1 ', text)
    text = re.sub(r'(?i)([a-zA-Z]+)(e-mail|email)', r'\1 \2', text)
    text = re.sub(r'([a-zA-Z]+)(S\.p\.A\.|Spa|S\.r\.l\.|Srl)', r'\1 \2', text, flags=re.IGNORECASE)
    text = re.sub(r'(S\.p\.A\.|Spa|S\.r\.l\.|Srl)([a-zA-Z]+)', r'\1 \2', text, flags=re.IGNORECASE)
    text = re.sub(r'([a-zA-Z]+)(a\.r\.|c\.a\.|c\.p\.)', r'\1 \2', text, flags=re.IGNORECASE)

    # Protect opaque tokens before segmentation.
    protected: List[str] = []
    def _protect_token(m: re.Match) -> str:
        idx = len(protected)
        protected.append(m.group(0))
        return f" __PROT_TOK_{idx}__ "

    text = re.sub(r'https?://[^\s,;]+', _protect_token, text)
    text = re.sub(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}', _protect_token, text)
    text = re.sub(r'\b[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]\b', _protect_token, text)

    # Separate abbreviation markers.
    text = re.sub(r'([a-zA-Z]+)(N[°º\.\?])', r'\1 \2', text)
    text = re.sub(r'(?i)(N[°º\.\?])(?=[0-9A-Z])', r'\1 ', text)

    # Separate symbols.
    text = re.sub(r'(\*+)', r' \1 ', text)
    text = re.sub(r'([,;:\?!])', r'\1 ', text)
    text = re.sub(r'(?<=[a-zA-Z])(\/)(?=[a-zA-Z])', r' \1 ', text)

    # Split letters and digits.
    text = re.sub(r'(?<=[a-zA-Z°º])([0-9]+)', r' \1', text)
    text = re.sub(r'(?<=[0-9])([a-zA-Z]+)', r' \1', text)

    # Split compound casing.
    text = re.sub(r'([a-z])([A-Z])', r'\1 \2', text)
    text = re.sub(r'([A-Z]{2,})([A-Z][a-z])', r'\1 \2', text)

    # Rejoin fragmented uppercase tokens.
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
        # Restore protected tokens unchanged.
        if raw_tok.startswith("__PROT_TOK_") and raw_tok.endswith("__"):
            try:
                prot_idx = int(raw_tok[len("__PROT_TOK_"):-2])
                cleaned_tokens.append(protected[prot_idx])
                continue
            except (ValueError, IndexError):
                pass

        # Segment apostrophe-delimited compounds.
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

        # Preserve punctuation around segments.
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
