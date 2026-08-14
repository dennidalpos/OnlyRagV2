import os
import base64
import subprocess
from typing import Dict, Any, Optional
from sidecar.config import httpx_client, logger

# OCR Engine Singleton Caches
_GPU_INFO_CACHE: Optional[Dict[str, Any]] = None
_EASYOCR_READER: Any = None
_PADDLEOCR_READER: Any = None
_DOCLING_CONVERTER: Any = None

def _prepare_image_for_ocr(image_bytes: bytes, max_dim: int = 2048) -> bytes:
    """Downscales oversized images to max_dim on the longest edge to prevent OOM/timeouts."""
    try:
        from PIL import Image
        import io
        img = Image.open(io.BytesIO(image_bytes))
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
    except Exception as e:
        logger.debug(f"Image preprocessing skipped: {e}")
    return image_bytes

def run_layout_ocr(
    image_bytes: bytes,
    prompt: str = "Extract all text, tables, and key structure from this document image in clean Markdown format.",
    ollama_url: str = "http://127.0.0.1:11434",
    model: str = "llama3.2-vision"
) -> str:
    """Multi-tiered Document Layout OCR Engine with lazy singleton caches (Docling/Surya/PaddleOCR/Tesseract/Ollama Vision)."""
    global _DOCLING_CONVERTER, _EASYOCR_READER, _PADDLEOCR_READER
    
    prepared_bytes = _prepare_image_for_ocr(image_bytes)
    gpu_info = detect_gpu_acceleration()

    # Tier 1: Try Docling Layout Parsing if available
    try:
        import io
        from docling.document_converter import DocumentConverter
        if _DOCLING_CONVERTER is None:
            _DOCLING_CONVERTER = DocumentConverter()
        doc_stream = io.BytesIO(prepared_bytes)
        result = _DOCLING_CONVERTER.convert_single(doc_stream)
        exported_md = result.document.export_to_markdown().strip()
        if exported_md:
            logger.info("Layout OCR successfully performed via Docling engine.")
            return exported_md
    except ImportError:
        pass
    except Exception as docling_err:
        logger.warning(f"Docling OCR processing failed: {docling_err}")

    # Tier 2: Try EasyOCR / PaddleOCR / Pytesseract if available
    try:
        import numpy as np
        from PIL import Image
        import io
        img = Image.open(io.BytesIO(prepared_bytes)).convert("RGB")

        # Try EasyOCR
        try:
            import easyocr
            if _EASYOCR_READER is None:
                _EASYOCR_READER = easyocr.Reader(['en', 'it'], gpu=gpu_info["has_cuda"])
            ocr_results = _EASYOCR_READER.readtext(np.array(img), detail=0)
            if ocr_results:
                text_out = "\n\n".join(ocr_results).strip()
                logger.info("OCR successfully performed via EasyOCR.")
                return text_out
        except ImportError:
            pass

        # Try PaddleOCR
        try:
            from paddleocr import PaddleOCR
            if _PADDLEOCR_READER is None:
                _PADDLEOCR_READER = PaddleOCR(use_angle_cls=True, lang='en', use_gpu=gpu_info["has_cuda"])
            res = _PADDLEOCR_READER.ocr(np.array(img), cls=True)
            lines = []
            if res and res[0]:
                for line in res[0]:
                    if line and len(line) > 1 and line[1]:
                        lines.append(line[1][0])
            if lines:
                text_out = "\n".join(lines).strip()
                logger.info("OCR successfully performed via PaddleOCR.")
                return text_out
        except ImportError:
            pass

        # Try Pytesseract
        try:
            import pytesseract
            text_out = pytesseract.image_to_string(img).strip()
            if text_out:
                logger.info("OCR successfully performed via Pytesseract.")
                return text_out
        except ImportError:
            pass
    except Exception as ocr_lib_err:
        logger.warning(f"Local OCR engine attempt failed: {ocr_lib_err}")

    # Tier 3: Ollama Vision Model Fallback
    return run_vision_ocr(prepared_bytes, prompt, ollama_url, model=model)

def run_vision_ocr(
    image_bytes: bytes,
    prompt: str = "Extract all text, tables, and key structure from this document image in clean Markdown format.",
    ollama_url: str = "http://127.0.0.1:11434",
    model: str = "llama3.2-vision"
) -> str:
    """Uses Ollama Vision model for OCR and document vision parsing with strict timeout."""
    candidate_models = [m for m in [model, "llama3.2-vision", "minicpm-v", "llava", "moondream"] if m]
    try:
        prepared_bytes = _prepare_image_for_ocr(image_bytes, max_dim=1536)
        b64_img = base64.b64encode(prepared_bytes).decode("utf-8")
        for v_model in candidate_models:
            payload = {
                "model": v_model,
                "prompt": prompt,
                "images": [b64_img],
                "stream": False
            }
            try:
                res = httpx_client.post(f"{ollama_url}/api/generate", json=payload, timeout=25.0)
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

def run_layout_ocr(
    image_bytes: bytes,
    prompt: str = "Extract all text, tables, and key structure from this document image in clean Markdown format.",
    ollama_url: str = "http://127.0.0.1:11434",
    model: str = "llama3.2-vision"
) -> str:
    """Multi-tiered Document Layout OCR Engine (Docling/Surya/PaddleOCR with fallback to Ollama Vision)."""
    gpu_info = detect_gpu_acceleration()

    # Tier 1: Try Docling Layout Parsing if available
    try:
        import io
        from docling.document_converter import DocumentConverter
        converter = DocumentConverter()
        doc_stream = io.BytesIO(image_bytes)
        result = converter.convert_single(doc_stream)
        exported_md = result.document.export_to_markdown().strip()
        if exported_md:
            logger.info("Layout OCR successfully performed via Docling engine.")
            return exported_md
    except ImportError:
        pass
    except Exception as docling_err:
        logger.warning(f"Docling OCR processing failed: {docling_err}")

    # Tier 2: Try Surya OCR / PaddleOCR / EasyOCR if available
    try:
        import numpy as np
        from PIL import Image
        import io
        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")

        # Try EasyOCR
        try:
            import easyocr
            reader = easyocr.Reader(['en', 'it'], gpu=gpu_info["has_cuda"])
            ocr_results = reader.readtext(np.array(img), detail=0)
            if ocr_results:
                text_out = "\n\n".join(ocr_results).strip()
                logger.info("OCR successfully performed via EasyOCR.")
                return text_out
        except ImportError:
            pass

        # Try PaddleOCR
        try:
            from paddleocr import PaddleOCR
            ocr = PaddleOCR(use_angle_cls=True, lang='en', use_gpu=gpu_info["has_cuda"])
            res = ocr.ocr(np.array(img), cls=True)
            lines = []
            if res and res[0]:
                for line in res[0]:
                    if line and len(line) > 1 and line[1]:
                        lines.append(line[1][0])
            if lines:
                text_out = "\n".join(lines).strip()
                logger.info("OCR successfully performed via PaddleOCR.")
                return text_out
        except ImportError:
            pass
    except Exception as ocr_lib_err:
        logger.warning(f"Local OCR engine attempt failed: {ocr_lib_err}")

    # Tier 3: Ollama Vision Model Fallback
    return run_vision_ocr(image_bytes, prompt, ollama_url, model=model)

def run_vision_ocr(
    image_bytes: bytes,
    prompt: str = "Extract all text, tables, and key structure from this document image in clean Markdown format.",
    ollama_url: str = "http://127.0.0.1:11434",
    model: str = "llama3.2-vision"
) -> str:
    """Uses Ollama Vision model for OCR and document vision parsing with strict timeout."""
    candidate_models = [m for m in [model, "llama3.2-vision", "minicpm-v", "llava", "moondream"] if m]
    try:
        b64_img = base64.b64encode(image_bytes).decode("utf-8")
        for v_model in candidate_models:
            payload = {
                "model": v_model,
                "prompt": prompt,
                "images": [b64_img],
                "stream": False
            }
            try:
                res = httpx_client.post(f"{ollama_url}/api/generate", json=payload, timeout=25.0)
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
