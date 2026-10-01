import sys
import threading
import time
import types
from concurrent.futures import ThreadPoolExecutor

import pytest

from sidecar.infrastructure import ocr


@pytest.fixture
def fake_rapidocr(monkeypatch):
    constructions = []

    class SlowRapidOCR:
        def __init__(self, **kwargs):
            constructions.append(kwargs)
            time.sleep(0.05)

    module = types.ModuleType("rapidocr")
    module.RapidOCR = SlowRapidOCR
    monkeypatch.setitem(sys.modules, "rapidocr", module)
    monkeypatch.setattr(ocr, "_rapidocr_cuda_available", lambda: False)
    monkeypatch.setattr(ocr, "_RAPIDOCR_ENGINE", None)
    return constructions


def test_concurrent_first_calls_build_one_engine(fake_rapidocr):
    workers = 8
    barrier = threading.Barrier(workers)

    def get_engine():
        barrier.wait()
        return ocr._get_rapidocr_engine()

    with ThreadPoolExecutor(max_workers=workers) as pool:
        engines = list(pool.map(lambda _: get_engine(), range(workers)))

    assert len(fake_rapidocr) == 1
    assert all(engine is engines[0] for engine in engines)


def test_failed_initialization_is_retried_on_next_call(monkeypatch, fake_rapidocr):
    attempts = {"count": 0}
    working = sys.modules["rapidocr"].RapidOCR

    class FailingOnce:
        def __init__(self, **kwargs):
            attempts["count"] += 1
            if attempts["count"] == 1:
                raise RuntimeError("model files missing")
            working(**kwargs)

    monkeypatch.setattr(sys.modules["rapidocr"], "RapidOCR", FailingOnce)

    with pytest.raises(RuntimeError):
        ocr._get_rapidocr_engine()
    assert ocr._RAPIDOCR_ENGINE is None
    assert isinstance(ocr._get_rapidocr_engine(), FailingOnce)


def test_layout_ocr_keeps_contrast_and_separates_uncertain_colored_marks(monkeypatch):
    import io
    import numpy as np
    from PIL import Image, ImageDraw

    image = Image.new("RGB", (400, 300), (235, 236, 237))
    draw = ImageDraw.Draw(image)
    draw.line([(210, 90), (260, 70), (280, 110)], fill=(20, 40, 160), width=3)
    stream = io.BytesIO()
    image.save(stream, format="PNG")

    def recognize(payload):
        with Image.open(io.BytesIO(payload)) as received:
            assert received.getpixel((0, 0)) == (235, 236, 237)
        return types.SimpleNamespace(
            boxes=np.array([[[20, 20], [150, 20], [150, 40], [20, 40]],
                            [[200, 60], [290, 60], [290, 120], [200, 120]]], dtype=np.float32),
            txts=["Signature label", "Handwriting noise"], scores=[0.99, 0.5],
        )

    monkeypatch.setattr(ocr, "_get_rapidocr_engine", lambda: recognize)
    regions = ocr.run_rapid_ocr_with_boxes(stream.getvalue())
    assert regions[0]["text"] == "Signature label"
    assert regions[0]["is_graphic"] is False
    assert regions[1]["text"] == ""
    assert regions[1]["is_graphic"] is True
    assert regions[1]["protected_bbox"][1] > regions[1]["bbox"][1]
    assert all(type(value) is float for value in regions[0]["bbox"])
