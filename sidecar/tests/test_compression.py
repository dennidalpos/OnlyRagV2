import os
import sys
import pymupdf
import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from sidecar.domain.exporter import _render_pdf_from_markdown

@pytest.mark.parametrize("content,expected", [
    ("# 日本語\n\nПривет мир\n\n한국어", ["日本語", "Привет мир", "한국어"]),
    (("Long paragraph preserves every word. " * 120) + "ENDMARKER", ["ENDMARKER"]),
    ("```python\n" + "\n".join(f"line_{i} = {i}" for i in range(100)), ["line_99 = 99"]),
    ("<img src=\"file:///private.png\"> & text", ["private.png", "& text"]),
])
def test_pdf_export_preserves_content(tmp_path, content, expected):
    output = tmp_path / "content.pdf"
    _render_pdf_from_markdown(content, str(output))
    with pymupdf.open(output) as document:
        text = "\n".join(page.get_text() for page in document)
    for fragment in expected:
        assert fragment in text

def test_pdf_export_compression(tmp_path):
    markdown_sample = """# Relazione Tecnica Progetto OnlyRag V2

## 1. Introduzione
Questo documento di prova contiene molteplici sezioni, testo esteso e tabelle per verificare che l'esportatore PDF applichi la compressione profonda stream e garbage collection.

| Parametro | Valore | Note |
| :--- | :--- | :--- |
| Compression | Deflate + Garbage 4 | Riduzione dimensione file |
| Engine | PyMuPDF | Veloce e affidabile |
| Status | Validated | Conforme alle direttive |

```python
def compute_metrics():
    return {"status": "optimized", "ratio": "60-90%"}
```

## 2. Dettagli di Esecuzione
Testo di riempimento per verificare che la generazione PDF con stream compressi produca un file valido e leggibile.
"""
    out_pdf = str(tmp_path / "compressed_output.pdf")
    _render_pdf_from_markdown(markdown_sample, out_pdf)

    assert os.path.exists(out_pdf)
    file_size = os.path.getsize(out_pdf)
    assert file_size > 0

    # Ensure the compressed PDF is fully valid and readable by PyMuPDF
    doc = pymupdf.open(out_pdf)
    try:
        assert len(doc) >= 1
        full_text = "\n".join(p.get_text() for p in doc)
        assert "Introduzione" in full_text
        assert "compute_metrics" in full_text
    finally:
        doc.close()
