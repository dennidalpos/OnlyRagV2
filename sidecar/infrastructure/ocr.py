import os
import base64
import subprocess
from typing import Dict, Any, Optional, List, Tuple
from sidecar.config import httpx_client, logger
from sidecar.domain.word_segmenter import normalize_ocr_token_spacing

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

def compute_deskew_angle(image_np: Any) -> float:
    """Computes skew angle (in degrees) of a text document image using morphological filtering
    and minimum bounding area of text contours. Returns angle in [-45, 45]."""
    try:
        import cv2
        import numpy as np

        if len(image_np.shape) == 3:
            gray = cv2.cvtColor(image_np, cv2.COLOR_RGB2GRAY)
        else:
            gray = image_np

        # Binarize with Otsu
        thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)[1]

        # Dilate horizontally to connect text lines
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (30, 5))
        dilated = cv2.dilate(thresh, kernel, iterations=2)

        # Find all contours
        contours, _ = cv2.findContours(dilated, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        angles = []
        for c in contours:
            area = cv2.contourArea(c)
            if area < 1000:
                continue
            rect = cv2.minAreaRect(c)
            angle = rect[-1]
            if angle < -45:
                angle = -(90 + angle)
            elif angle > 45:
                angle = 90 - angle
            angles.append(angle)

        if not angles:
            return 0.0

        median_angle = float(np.median(angles))
        return median_angle
    except Exception as e:
        logger.debug(f"Deskew angle computation skipped: {e}")
        return 0.0


def deskew_image(image_bytes: bytes) -> bytes:
    """Deskews an input document image bytes if skew exceeds 0.2 degrees, returning deskewed PNG bytes."""
    try:
        import cv2
        import numpy as np

        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            return image_bytes

        angle = compute_deskew_angle(img)
        if abs(angle) < 0.2 or abs(angle) > 45.0:
            return image_bytes

        h, w = img.shape[:2]
        center = (w // 2, h // 2)
        rot_mat = cv2.getRotationMatrix2D(center, angle, 1.0)
        deskewed = cv2.warpAffine(img, rot_mat, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)

        is_success, buffer = cv2.imencode(".png", deskewed)
        if is_success:
            logger.info(f"Scanned document deskewed by {angle:.2f} degrees.")
            return buffer.tobytes()
    except Exception as err:
        logger.debug(f"Deskewing failed: {err}")
    return image_bytes


def inpaint_raster_bounding_boxes(image_bytes: bytes, bboxes: List[Tuple[float, float, float, float]], inpaint_radius: int = 3) -> bytes:
    """Removes text in bounding boxes (x0, y0, x1, y1) from a raster image using OpenCV Navier-Stokes/Telea inpainting,
    preserving backgrounds and textures under the original text."""
    if not bboxes:
        return image_bytes
    try:
        import cv2
        import numpy as np

        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            return image_bytes

        h, w = img.shape[:2]
        mask = np.zeros((h, w), dtype=np.uint8)

        for bbox in bboxes:
            x0, y0, x1, y1 = bbox
            ix0 = max(0, int(round(x0 - 2)))
            iy0 = max(0, int(round(y0 - 2)))
            ix1 = min(w, int(round(x1 + 2)))
            iy1 = min(h, int(round(y1 + 2)))
            if ix1 > ix0 and iy1 > iy0:
                cv2.rectangle(mask, (ix0, iy0), (ix1, iy1), 255, -1)

        inpainted = cv2.inpaint(img, mask, inpaintRadius=inpaint_radius, flags=cv2.INPAINT_TELEA)
        is_success, buffer = cv2.imencode(".png", inpainted)
        if is_success:
            return buffer.tobytes()
    except Exception as err:
        logger.warning(f"Inpainting bounding boxes failed: {err}")
    return image_bytes


def _prepare_image_for_ocr(image_bytes: bytes, max_dim: int = 2560, allow_deskew: bool = True) -> bytes:
    """Prepares image for OCR, normalizing color channels, applying CLAHE luminance enhancement, deskewing (optional), and downscaling only if exceeding max_dim."""
    try:
        # 1. Apply deskewing first for scanned images when rotation is allowed
        if allow_deskew:
            try:
                image_bytes = deskew_image(image_bytes)
            except Exception as deskew_err:
                logger.debug(f"Deskewing step failed in _prepare_image_for_ocr: {deskew_err}")

        # 2. Apply OpenCV CLAHE & mild unsharp masking on luminance channel
        try:
            import cv2
            import numpy as np
            nparr = np.frombuffer(image_bytes, np.uint8)
            cv_img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if cv_img is not None:
                lab = cv2.cvtColor(cv_img, cv2.COLOR_BGR2LAB)
                l, a, b = cv2.split(lab)
                clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
                cl = clahe.apply(l)
                # Unsharp mask on luminance
                gaussian = cv2.GaussianBlur(cl, (0, 0), 2.0)
                unsharp = cv2.addWeighted(cl, 1.25, gaussian, -0.25, 0)
                merged = cv2.merge((unsharp, a, b))
                enhanced_bgr = cv2.cvtColor(merged, cv2.COLOR_LAB2BGR)
                success, enc_buf = cv2.imencode(".png", enhanced_bgr)
                if success:
                    image_bytes = enc_buf.tobytes()
        except Exception as cv_err:
            logger.debug(f"OpenCV CLAHE enhancement skipped: {cv_err}")

        from PIL import Image, ImageOps
        import io
        Image.MAX_IMAGE_PIXELS = 60_000_000
        img = Image.open(io.BytesIO(image_bytes))

        # Auto-orient EXIF metadata if present
        try:
            img = ImageOps.exif_transpose(img)
        except Exception:
            pass

        if img.mode in ("RGBA", "P", "LA"):
            img = img.convert("RGB")
        elif img.mode != "RGB":
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

def _find_rapidocr_config() -> Optional[str]:
    """Locates rapidocr_onnxruntime config.yaml across packaged PyInstaller and standard Python environments."""
    import sys
    # 1. Check direct module path
    try:
        import rapidocr_onnxruntime
        mod_dir = os.path.dirname(os.path.abspath(rapidocr_onnxruntime.__file__))
        cfg_cand = os.path.join(mod_dir, "config.yaml")
        if os.path.exists(cfg_cand):
            return cfg_cand
    except Exception:
        pass

    # 2. Check sys._MEIPASS (PyInstaller runtime)
    if hasattr(sys, "_MEIPASS"):
        meipass_cfg = os.path.join(getattr(sys, "_MEIPASS"), "rapidocr_onnxruntime", "config.yaml")
        if os.path.exists(meipass_cfg):
            return meipass_cfg

    # 3. Check executable-relative _internal directory
    exe_dir = os.path.dirname(os.path.abspath(sys.executable))
    internal_cfg = os.path.join(exe_dir, "_internal", "rapidocr_onnxruntime", "config.yaml")
    if os.path.exists(internal_cfg):
        return internal_cfg

    # 4. Check resources directory in packaged Electron installation
    res_cfg = os.path.join(exe_dir, "..", "resources", "sidecar", "_internal", "rapidocr_onnxruntime", "config.yaml")
    if os.path.exists(res_cfg):
        return os.path.abspath(res_cfg)

    return None

def _reconstruct_layout_from_ocr_boxes(raw_results: Any) -> str:
    """Groups detected OCR bounding boxes into visual lines and paragraphs in reading order with multi-column support via vectorized NumPy."""
    if not raw_results:
        return ""

    import numpy as np

    extracted = []
    for item in raw_results:
        if not item or len(item) < 2:
            continue
        pts, text = item[0], str(item[1]).strip()
        if not text:
            continue
        pts_arr = np.array(pts, dtype=np.float32)
        x0, y0 = float(pts_arr[:, 0].min()), float(pts_arr[:, 1].min())
        x1, y1 = float(pts_arr[:, 0].max()), float(pts_arr[:, 1].max())
        h = max(1.0, y1 - y0)
        cy = (y0 + y1) / 2.0
        extracted.append({
            "x0": x0, "y0": y0, "x1": x1, "y1": y1,
            "h": h, "cy": cy, "text": text
        })

    if not extracted:
        return ""

    # Sort top-to-bottom, left-to-right
    extracted.sort(key=lambda b: (b["y0"], b["x0"]))

    # Cluster horizontally aligned boxes into visual lines
    lines: List[Dict[str, Any]] = []
    for b in extracted:
        matched_line = None
        for line in lines:
            line_cy = line["cy"]
            line_h = line["h"]
            vert_match = abs(b["cy"] - line_cy) <= line_h * 0.5 or (min(b["y1"], line["y1"]) - max(b["y0"], line["y0"]) > 0.4 * min(b["h"], line_h))
            if vert_match:
                # Column separation guard: do not merge horizontally distant blocks (e.g. form fields on distinct columns)
                horiz_gap = b["x0"] - line["x1"] if b["x0"] >= line["x1"] else line["x0"] - b["x1"]
                if horiz_gap <= max(16.0, line_h * 0.85):
                    matched_line = line
                    break

        if matched_line is not None:
            matched_line["boxes"].append(b)
            matched_line["x0"] = min(matched_line["x0"], b["x0"])
            matched_line["y0"] = min(matched_line["y0"], b["y0"])
            matched_line["x1"] = max(matched_line["x1"], b["x1"])
            matched_line["y1"] = max(matched_line["y1"], b["y1"])
            matched_line["cy"] = (matched_line["y0"] + matched_line["y1"]) / 2.0
            matched_line["h"] = matched_line["y1"] - matched_line["y0"]
        else:
            lines.append({
                "y0": b["y0"], "y1": b["y1"], "x0": b["x0"], "x1": b["x1"],
                "cy": b["cy"], "h": b["h"],
                "boxes": [b]
            })

    lines.sort(key=lambda l: l["y0"])

    formatted_paragraphs: List[str] = []
    current_para: List[str] = []
    prev_line = None

    for line in lines:
        line["boxes"].sort(key=lambda b: b["x0"])
        raw_line_text = " ".join(b["text"] for b in line["boxes"])
        line_text = normalize_ocr_token_spacing(raw_line_text)

        if prev_line is not None:
            gap = line["y0"] - prev_line["y1"]
            if gap > prev_line["h"] * 1.3:
                if current_para:
                    formatted_paragraphs.append("\n".join(current_para))
                    current_para = []
        current_para.append(line_text)
        prev_line = line

    if current_para:
        formatted_paragraphs.append("\n".join(current_para))

    return "\n\n".join(formatted_paragraphs).strip()

def _get_rapidocr_engine():
    """Initializes or returns cached RapidOCR engine with high-resolution detection parameters."""
    global _RAPIDOCR_ENGINE
    from rapidocr_onnxruntime import RapidOCR

    if _RAPIDOCR_ENGINE is None:
        use_cuda = _rapidocr_cuda_available()
        cfg_path = _find_rapidocr_config()
        ocr_kwargs: Dict[str, Any] = {
            "det_use_cuda": use_cuda,
            "cls_use_cuda": use_cuda,
            "rec_use_cuda": use_cuda,
            "det_limit_side_len": 2500,
            "det_db_unclip_ratio": 1.6,
            "det_db_box_thresh": 0.5
        }
        if cfg_path:
            ocr_kwargs["config_path"] = cfg_path

        try:
            _RAPIDOCR_ENGINE = RapidOCR(**ocr_kwargs)
        except Exception as init_err:
            if use_cuda:
                logger.warning(f"RapidOCR CUDA initialization failed ({init_err}), falling back to CPU execution.")
                ocr_kwargs["det_use_cuda"] = False
                ocr_kwargs["cls_use_cuda"] = False
                ocr_kwargs["rec_use_cuda"] = False
                _RAPIDOCR_ENGINE = RapidOCR(**ocr_kwargs)
            else:
                raise init_err

    return _RAPIDOCR_ENGINE

def run_rapid_ocr_with_boxes(image_bytes: bytes) -> List[Dict[str, Any]]:
    """Runs RapidOCR with image enhancement and returns spatially clustered line blocks with bounding boxes
    accurately mapped back to the input image_bytes coordinate space."""
    engine = _get_rapidocr_engine()
    prepared_bytes = _prepare_image_for_ocr(image_bytes, max_dim=2560, allow_deskew=False)

    # Compute scale factors between prepared_bytes and original image_bytes
    scale_x, scale_y = 1.0, 1.0
    try:
        from PIL import Image
        import io
        orig_img = Image.open(io.BytesIO(image_bytes))
        prep_img = Image.open(io.BytesIO(prepared_bytes))
        if prep_img.width > 0 and prep_img.height > 0:
            scale_x = orig_img.width / float(prep_img.width)
            scale_y = orig_img.height / float(prep_img.height)
    except Exception:
        scale_x, scale_y = 1.0, 1.0

    result, _elapse = engine(prepared_bytes)
    if not result:
        return []

    boxes: List[Dict[str, Any]] = []
    for item in result:
        if not item or len(item) < 2:
            continue
        pts, text = item[0], str(item[1]).strip()
        if not text:
            continue
        x0 = min(p[0] for p in pts) * scale_x
        y0 = min(p[1] for p in pts) * scale_y
        x1 = max(p[0] for p in pts) * scale_x
        y1 = max(p[1] for p in pts) * scale_y
        h = max(1.0, y1 - y0)
        cy = (y0 + y1) / 2.0
        boxes.append({
            "x0": x0, "y0": y0, "x1": x1, "y1": y1,
            "h": h, "cy": cy, "text": text
        })

    if not boxes:
        return []

    boxes.sort(key=lambda b: (b["y0"], b["x0"]))

    lines: List[Dict[str, Any]] = []
    for b in boxes:
        matched_line = None
        for line in lines:
            line_cy = line["cy"]
            line_h = line["h"]
            # Check vertical alignment
            vert_match = abs(b["cy"] - line_cy) <= line_h * 0.5 or (min(b["y1"], line["y1"]) - max(b["y0"], line["y0"]) > 0.4 * min(b["h"], line_h))
            if vert_match:
                # Column separation guard: do not merge horizontally distant blocks (e.g. form fields on distinct columns)
                horiz_gap = b["x0"] - line["x1"] if b["x0"] >= line["x1"] else line["x0"] - b["x1"]
                if horiz_gap <= max(16.0, line_h * 0.85):
                    matched_line = line
                    break

        if matched_line is not None:
            matched_line["boxes"].append(b)
            matched_line["x0"] = min(matched_line["x0"], b["x0"])
            matched_line["y0"] = min(matched_line["y0"], b["y0"])
            matched_line["x1"] = max(matched_line["x1"], b["x1"])
            matched_line["y1"] = max(matched_line["y1"], b["y1"])
            matched_line["cy"] = (matched_line["y0"] + matched_line["y1"]) / 2.0
            matched_line["h"] = matched_line["y1"] - matched_line["y0"]
        else:
            lines.append({
                "y0": b["y0"], "y1": b["y1"], "x0": b["x0"], "x1": b["x1"],
                "cy": b["cy"], "h": b["h"],
                "boxes": [b]
            })

    lines.sort(key=lambda l: l["y0"])

    line_blocks: List[Dict[str, Any]] = []
    for line in lines:
        line["boxes"].sort(key=lambda b: b["x0"])
        raw_text = " ".join(b["text"] for b in line["boxes"])
        text = normalize_ocr_token_spacing(raw_text)
        line_blocks.append({
            "bbox": (line["x0"], line["y0"], line["x1"], line["y1"]),
            "text": text
        })

    return line_blocks

def run_rapid_ocr(image_bytes: bytes) -> str:
    """Fast local text-recognition OCR via RapidOCR (PP-OCR models exported to ONNX).
    Executes on CUDA when available, and automatically falls back to CPU execution on minimal/CPU-only hardware."""
    engine = _get_rapidocr_engine()
    prepared_bytes = _prepare_image_for_ocr(image_bytes, max_dim=2560)
    result, _elapse = engine(prepared_bytes)
    return _reconstruct_layout_from_ocr_boxes(result)

def run_layout_ocr(
    image_bytes: bytes,
    prompt: Optional[str] = None,
    ollama_url: Optional[str] = None,
    model: Optional[str] = None
) -> str:
    """High-fidelity local OCR engine via RapidOCR.
    Extracts verbatim text lines, numbers, and layout without multimodal LLM hallucination or network latency."""
    prepared_bytes = _prepare_image_for_ocr(image_bytes, max_dim=2560)
    try:
        text_out = run_rapid_ocr(prepared_bytes)
        if text_out:
            logger.info("OCR successfully performed via RapidOCR.")
            return text_out
    except Exception as rapid_err:
        logger.warning(f"RapidOCR processing failed: {rapid_err}")

    return ""

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
