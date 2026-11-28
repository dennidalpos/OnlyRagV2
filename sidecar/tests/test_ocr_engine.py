import sys
import threading
import time
import types
from concurrent.futures import ThreadPoolExecutor

import pytest
from sidecar.infrastructure import ocr


@pytest.mark.parametrize("format", ["PNG", "JPEG", "TIFF", "BMP", "GIF", "WEBP"])
def test_native_image_codecs_preserve_ocr_preprocessing_contract(format):
    """Exercise the installed native Pillow wheel, not a mocked Image module."""
    import io
    from PIL import Image

    original = io.BytesIO()
    Image.new("RGB", (96, 48), (240, 240, 240)).save(original, format=format)
    prepared = ocr._prepare_image_for_ocr(original.getvalue(), max_dim=64, allow_deskew=False, enhance=False)
    assert prepared != original.getvalue()
    with Image.open(io.BytesIO(prepared)) as image:
        image.load()
        assert image.format == "PNG"
        assert image.mode == "RGB"
        assert image.size == (64, 32)
        assert all(abs(channel - 240) <= 2 for channel in image.getpixel((0, 0)))


def test_native_image_orientation_is_applied_before_ocr_resize():
    import io
    from PIL import Image

    original = io.BytesIO()
    image = Image.new("RGB", (96, 48), "white")
    exif = image.getexif()
    exif[274] = 6
    image.save(original, format="JPEG", exif=exif)
    prepared = ocr._prepare_image_for_ocr(original.getvalue(), max_dim=64, allow_deskew=False, enhance=False)
    with Image.open(io.BytesIO(prepared)) as result:
        result.load()
        assert result.size == (32, 64)

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


@pytest.fixture
def runtime_engine(monkeypatch):
    monkeypatch.setattr(ocr, "_RAPIDOCR_ENGINE", None)
    monkeypatch.setattr(ocr, "_rapidocr_cuda_available", lambda: True)
    monkeypatch.setattr(ocr, "detect_gpu_acceleration", lambda: {"has_cuda": True})
    module = types.ModuleType("rapidocr")
    monkeypatch.setitem(sys.modules, "rapidocr", module)
    calls = []

    def install(provider_lists, *, cuda_error=False, cpu_error=False):
        def construct(*, params):
            use_cuda = params["EngineConfig.onnxruntime.use_cuda"]
            calls.append(use_cuda)
            if (use_cuda and cuda_error) or (not use_cuda and cpu_error):
                raise RuntimeError("fixture initialization failure")
            return types.SimpleNamespace(**{
                name: types.SimpleNamespace(session=types.SimpleNamespace(
                    session=types.SimpleNamespace(get_providers=lambda providers=providers: providers)
                ))
                for name, providers in zip(("text_det", "text_cls", "text_rec"), provider_lists)
            })
        module.RapidOCR = construct

    return install, calls


@pytest.mark.parametrize("scenario,expected", [
    ("uninitialized", "unknown"),
    ("cuda", "CUDAExecutionProvider"),
    ("cuda_exception", "CPUExecutionProvider"),
    ("silent_cpu_fallback", "CPUExecutionProvider"),
    ("cpu_only", "CPUExecutionProvider"),
    ("mixed", "unknown"),
    ("empty_session", "unknown"),
    ("unreadable_session", "unknown"),
    ("missing_session", "unknown"),
    ("unrecognized_provider", "unknown"),
    ("initialization_failed", "unknown"),
])
def test_runtime_and_health_report_initialized_sessions(scenario, expected, runtime_engine, monkeypatch, sidecar_http_client):
    install, calls = runtime_engine
    provider_lists = [["CUDAExecutionProvider", "CPUExecutionProvider"] for _ in range(3)]
    if scenario in ("cuda_exception", "silent_cpu_fallback", "cpu_only", "initialization_failed"):
        provider_lists = [["CPUExecutionProvider"] for _ in range(3)]
    if scenario == "cpu_only":
        monkeypatch.setattr(ocr, "_rapidocr_cuda_available", lambda: False)
        monkeypatch.setattr(ocr, "detect_gpu_acceleration", lambda: {"has_cuda": False})
    if scenario == "mixed":
        provider_lists[1] = ["CPUExecutionProvider"]
    if scenario == "empty_session":
        provider_lists[1] = []
    if scenario == "unrecognized_provider":
        provider_lists = [["OtherExecutionProvider"] for _ in range(3)]
    install(provider_lists, cuda_error=scenario in ("cuda_exception", "initialization_failed"),
            cpu_error=scenario == "initialization_failed")
    if scenario == "initialization_failed":
        with pytest.raises(RuntimeError, match="fixture initialization failure"):
            ocr._get_rapidocr_engine()
    elif scenario != "uninitialized":
        engine = ocr._get_rapidocr_engine()
        if scenario == "unreadable_session":
            def fail():
                raise RuntimeError("session unavailable")
            engine.text_rec.session.session.get_providers = fail
        if scenario == "missing_session":
            del engine.text_det.session
    expected_calls = list(calls)
    facts = {"provider": expected, "host_has_gpu": scenario != "cpu_only"}
    assert ocr.get_ocr_runtime_info() == facts
    response = sidecar_http_client.get("/health")
    assert response.status_code == 200
    assert response.json()["ocr"] == facts
    assert calls == expected_calls  # Health must never construct or retry the OCR engine.
    if scenario == "cuda_exception":
        assert calls == [True, False]
    if scenario == "initialization_failed":
        assert ocr._RAPIDOCR_ENGINE is None


def test_health_during_initialization_never_confirms_cuda(runtime_engine, sidecar_http_client, monkeypatch):
    install, calls = runtime_engine
    install([["CPUExecutionProvider"] for _ in range(3)])
    started, release = threading.Event(), threading.Event()
    construct = sys.modules["rapidocr"].RapidOCR

    def delayed(*, params):
        started.set()
        assert release.wait(5), "Fixture did not release initialization"
        return construct(params=params)

    monkeypatch.setattr(sys.modules["rapidocr"], "RapidOCR", delayed)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(ocr._get_rapidocr_engine)
        try:
            assert started.wait(5)
            second = pool.submit(ocr._get_rapidocr_engine)
            assert ocr.get_ocr_runtime_info()["provider"] == "unknown"
            assert sidecar_http_client.get("/health").json()["ocr"]["provider"] == "unknown"
        finally:
            release.set()
        assert first.result(timeout=5) is second.result(timeout=5)
    assert calls == [True]
    assert sidecar_http_client.get("/health").json()["ocr"]["provider"] == "CPUExecutionProvider"


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
