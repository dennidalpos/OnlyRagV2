import os
import base64
import subprocess
from typing import Dict, Any, Optional
from sidecar.config import httpx_client, logger

# OCR Engine Singleton Caches
_GPU_INFO_CACHE: Optional[Dict[str, Any]] = None
_RAPIDOCR_ENGINE: Any = None
_INSTALLED_OLLAMA_MODELS_CACHE: Optional[set] = None


def _get_installed_ollama_model_names(ollama_url: str) -> Optional[set]:
    """Lists locally installed Ollama model names (both with and without their ":tag" suffix, so
    a caller can match either form), cached for the sidecar process's lifetime -- installed models
    don't change mid-session. Returns None (not an empty set) if the listing itself failed, so
    callers can tell "confirmed nothing installed" apart from "couldn't check" and fall back to
    trying candidates blindly rather than skipping OCR entirely."""
    global _INSTALLED_OLLAMA_MODELS_CACHE
    if _INSTALLED_OLLAMA_MODELS_CACHE is not None:
        return _INSTALLED_OLLAMA_MODELS_CACHE
    try:
        res = httpx_client.get(f"{ollama_url}/api/tags", timeout=5.0)
        if res.status_code == 200:
            names = set()
            for entry in res.json().get("models", []):
                name = entry.get("name", "")
                if name:
                    names.add(name)
                    names.add(name.split(":")[0])
            _INSTALLED_OLLAMA_MODELS_CACHE = names
            return names
    except Exception as err:
        logger.debug(f"Could not list installed Ollama models: {err}")
    return None

def _prepare_image_for_ocr(image_bytes: bytes, max_dim: int = 2048) -> bytes:
    """Downscales oversized images to max_dim on the longest edge to prevent OOM and timeouts on CPU and GPU."""
    try:
        from PIL import Image
        import io
        Image.MAX_IMAGE_PIXELS = 60_000_000
        img = Image.open(io.BytesIO(image_bytes))
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")
        width, height = img.size
        if width > max_dim or height > max_dim:
            if width > height:
                new_w = max_dim
                new_h = max(1, int(height * (max_dim / width)))
            else:
                new_h = max_dim
                new_w = max(1, int(width * (max_dim / height)))
            img = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
            out_buf = io.BytesIO()
            img.save(out_buf, format="PNG")
            return out_buf.getvalue()
        elif img.mode != "RGB":
            out_buf = io.BytesIO()
            img.save(out_buf, format="PNG")
            return out_buf.getvalue()
    except Exception as e:
        logger.debug(f"Image preprocessing skipped: {e}")
    return image_bytes

def _rapidocr_cuda_available() -> bool:
    """Checks whether onnxruntime itself (not just the system GPU) exposes CUDAExecutionProvider.
    RapidOCR runs on onnxruntime, so this is the accurate signal for its GPU path -- a CUDA GPU
    detected via PyTorch elsewhere doesn't guarantee onnxruntime-gpu is the installed variant."""
    try:
        import onnxruntime as ort
        return "CUDAExecutionProvider" in ort.get_available_providers()
    except ImportError:
        return False

def run_rapid_ocr(image_bytes: bytes) -> str:
    """Fast local text-recognition OCR via RapidOCR (PP-OCR models exported to ONNX).
    Executes on CUDA when available, and automatically falls back to CPU execution on minimal/CPU-only hardware."""
    global _RAPIDOCR_ENGINE
    from rapidocr_onnxruntime import RapidOCR

    if _RAPIDOCR_ENGINE is None:
        use_cuda = _rapidocr_cuda_available()
        try:
            _RAPIDOCR_ENGINE = RapidOCR(det_use_cuda=use_cuda, cls_use_cuda=use_cuda, rec_use_cuda=use_cuda)
        except Exception as init_err:
            if use_cuda:
                logger.warning(f"RapidOCR CUDA initialization failed ({init_err}), falling back to CPU execution.")
                _RAPIDOCR_ENGINE = RapidOCR(det_use_cuda=False, cls_use_cuda=False, rec_use_cuda=False)
            else:
                raise init_err

    result, _elapse = _RAPIDOCR_ENGINE(image_bytes)
    if not result:
        return ""
    lines = [line[1] for line in result if line and len(line) > 1 and line[1]]
    return "\n".join(lines).strip()

def run_layout_ocr(
    image_bytes: bytes,
    prompt: str = "Extract all text, tables, and key structure from this document image in clean Markdown format.",
    ollama_url: str = "http://127.0.0.1:11434",
    model: str = "llama3.2-vision"
) -> str:
    """Two-tiered Document OCR Engine: RapidOCR (fast, GPU-capable / CPU-resilient local text recognition) first,
    falling back to the Ollama Vision model for layout-heavy content (tables, diagrams, complex
    scans) or when RapidOCR is unavailable / yields no text."""
    is_cuda_avail = _rapidocr_cuda_available() or detect_gpu_acceleration().get("has_cuda", False)
    max_dim = 2048 if is_cuda_avail else 1280
    prepared_bytes = _prepare_image_for_ocr(image_bytes, max_dim=max_dim)

    # Tier 1: RapidOCR (local, fast, CPU/GPU-capable via onnxruntime)
    try:
        text_out = run_rapid_ocr(prepared_bytes)
        if text_out:
            logger.info("OCR successfully performed via RapidOCR.")
            return text_out
    except ImportError:
        pass
    except Exception as rapid_err:
        logger.warning(f"RapidOCR processing failed: {rapid_err}")

    # Tier 2: Ollama Vision Model Fallback
    return run_vision_ocr(prepared_bytes, prompt, ollama_url, model=model)

def run_vision_ocr(
    image_bytes: bytes,
    prompt: str = "Extract all text, tables, and key structure from this document image in clean Markdown format.",
    ollama_url: str = "http://127.0.0.1:11434",
    model: str = "llama3.2-vision"
) -> str:
    """Uses Ollama Vision model for OCR and document vision parsing with adaptive timeout for CPU/GPU hosts."""
    is_cuda_avail = _rapidocr_cuda_available() or detect_gpu_acceleration().get("has_cuda", False)
    # On CPU-only hosts, downscale to 1024 to reduce visual patch tokenization and speed up inference ~3-4x
    vision_max_dim = 1536 if is_cuda_avail else 1024
    # On CPU-only hosts, allow up to 60s for full response generation
    vision_timeout = 25.0 if is_cuda_avail else 60.0

    candidate_models = list(dict.fromkeys(m for m in [model, "llama3.2-vision", "minicpm-v", "moondream", "llava"] if m))

    installed = _get_installed_ollama_model_names(ollama_url)
    if installed:
        filtered = [m for m in candidate_models if m in installed or m.split(":")[0] in installed]
        if filtered:
            candidate_models = filtered

    try:
        prepared_bytes = _prepare_image_for_ocr(image_bytes, max_dim=vision_max_dim)
        b64_img = base64.b64encode(prepared_bytes).decode("utf-8")
        for v_model in candidate_models:
            payload = {
                "model": v_model,
                "prompt": prompt,
                "images": [b64_img],
                "stream": False,
                "keep_alive": 0
            }
            try:
                res = httpx_client.post(f"{ollama_url}/api/generate", json=payload, timeout=vision_timeout)
                if res.status_code == 200:
                    text_resp = res.json().get("response", "").strip()
                    if text_resp:
                        return text_resp
            except Exception as candidate_err:
                logger.debug(f"Vision OCR with model {v_model} failed: {candidate_err}")
                continue
    except Exception as err:
        logger.warning(f"Ollama Vision OCR call skipped or timed out: {err}")

    return ""

def detect_gpu_acceleration() -> Dict[str, Any]:
    """Detects NVIDIA GPU CUDA availability via torch/onnxruntime or nvidia-smi execution."""
    global _GPU_INFO_CACHE
    if _GPU_INFO_CACHE is not None:
        return _GPU_INFO_CACHE

    info: Dict[str, Any] = {
        "has_cuda": False,
        "device_name": "CPU Only",
        "vram_total_mb": 0,
        "vram_free_mb": 0,
        "cuda_version": None,
        "backend": "cpu"
    }

    # 1. Try PyTorch CUDA
    try:
        import torch
        if torch.cuda.is_available():
            info["has_cuda"] = True
            info["device_name"] = torch.cuda.get_device_name(0)
            info["vram_total_mb"] = round(torch.cuda.get_device_properties(0).total_memory / (1024 * 1024))
            info["cuda_version"] = torch.version.cuda
            info["backend"] = "pytorch_cuda"
            _GPU_INFO_CACHE = info
            logger.info(f"CUDA GPU detected via PyTorch: {info['device_name']} ({info['vram_total_mb']} MB VRAM)")
            return info
    except ImportError:
        pass

    # 2. Try ONNX Runtime CUDA
    try:
        import onnxruntime as ort
        if "CUDAExecutionProvider" in ort.get_available_providers():
            info["has_cuda"] = True
            info["device_name"] = "CUDA Execution Provider (ONNX)"
            info["backend"] = "onnx_cuda"
            _GPU_INFO_CACHE = info
            logger.info("CUDA Execution Provider detected via ONNX Runtime.")
            return info
    except ImportError:
        pass

    # 3. Fallback to nvidia-smi execution check
    try:
        res = subprocess.run(
            ["nvidia-smi", "--query-gpu=gpu_name,memory.total,memory.free,driver_version", "--format=csv,noheader,nounits"],
            capture_output=True,
            text=True,
            timeout=3
        )
        if res.returncode == 0 and res.stdout.strip():
            parts = [p.strip() for p in res.stdout.strip().split(",")]
            if len(parts) >= 3:
                info["has_cuda"] = True
                info["device_name"] = parts[0]
                info["vram_total_mb"] = int(parts[1])
                info["vram_free_mb"] = int(parts[2])
                info["backend"] = "nvidia_smi"
                logger.info(f"NVIDIA GPU detected via nvidia-smi: {parts[0]}")
    except Exception:
        pass

    _GPU_INFO_CACHE = info
    return info
