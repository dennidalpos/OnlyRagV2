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
