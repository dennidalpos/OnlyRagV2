import re
import unicodedata

# Regex to identify ASCII/ANSI control characters (excluding newline \n, tab \t, carriage return \r)
_CONTROL_CHAR_REGEX = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\x80-\x9f]')

# Regex to match Private Use Area (PUA) codepoints from custom PDF fonts
_PUA_REGEX = re.compile(r'[\ue000-\uf8ff\U000f0000-\U000ffffd\U00100000-\U0010fffd]')

def sanitize_extracted_text(text: str) -> str:
    """
    Comprehensive sanitization of extracted document text from PDF / OCR engines:
    - Replaces font bullet PUA symbols (\uf0b7, \uf0a7, etc.) with markdown bullet points
    - Replaces non-breaking spaces (\xa0) with standard spaces
    - Cleans Private Use Area (PUA) unicode artifacts and corrupted font glyphs
    - Strips control characters, null bytes, zero-width spaces (\u200b), BOM
    - Normalizes Unicode to NFC
    - Normalizes line breaks (CRLF -> LF)
    """
    if not text:
        return ""

    # Normalize Unicode form to NFC
    text = unicodedata.normalize("NFC", text)

    # Convert common font-embedded bullet characters to standard markdown list dashes
    text = re.sub(r'[\uf0b7\uf0a7\uf076\uf0d8\u2022\u25cf\u25cb\u25aa\u25a0]\s*', '- ', text)

    # Normalize non-breaking and zero-width spaces
    text = text.replace('\xa0', ' ')
    text = text.replace('\u200b', '').replace('\u200c', '').replace('\u200d', '')
    text = text.replace('\ufeff', '').replace('\ufffe', '').replace('\ufffd', '')

    # Strip null bytes and non-printable control characters
    text = _CONTROL_CHAR_REGEX.sub('', text)

    # Strip remaining unmapped PUA font characters
    text = _PUA_REGEX.sub('', text)

    # Standardize line endings to LF
    text = text.replace('\r\n', '\n').replace('\r', '\n')

    # Trim trailing whitespace on individual lines
    lines = [line.rstrip() for line in text.split('\n')]
    sanitized = '\n'.join(lines)

    # Collapse excessive consecutive blank lines (max 2 empty lines)
    sanitized = re.sub(r'\n{4,}', '\n\n\n', sanitized)

    return sanitized.strip()
