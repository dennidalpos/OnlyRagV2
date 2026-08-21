import os
import json
import asyncio
from typing import Dict, Any, List, Optional
from sidecar.config import logger, httpx_client
from sidecar.domain.word_segmenter import get_vocab_manager, normalize_language_code

# Upstream registry endpoint for vocabulary dictionary pack updates
_DEFAULT_VOCAB_MANIFEST_URL = "https://raw.githubusercontent.com/dennidalpos/OnlyRagV2/main/sidecar/assets/vocab/manifest.json"

class VocabSyncService:
    """
    Asynchronous Vocabulary Synchronizer.
    Checks for language vocabulary dictionary updates at startup and downloads updated packs
    atomically into %APPDATA%/onlyrag-v2/vocab/ without blocking startup or offline operations.
    """
    def __init__(self, manifest_url: str = _DEFAULT_VOCAB_MANIFEST_URL, cache_dir: Optional[str] = None):
        self.manifest_url = manifest_url
        if not cache_dir:
            appdata = os.environ.get("APPDATA") or os.path.expanduser("~/.onlyrag_v2")
            self.cache_dir = os.path.join(appdata, "onlyrag-v2", "vocab")
        else:
            self.cache_dir = cache_dir

    def _ensure_cache_dir(self) -> None:
        os.makedirs(self.cache_dir, exist_ok=True)

    async def sync_vocabularies(self, timeout_sec: float = 3.0) -> Dict[str, Any]:
        """
        Non-blocking check and update for language vocabularies.
        Returns status report (updated, current, or offline).
        """
        self._ensure_cache_dir()
        updated_langs: List[str] = []
        current_langs: List[str] = []

        try:
            resp = await asyncio.to_thread(httpx_client.get, self.manifest_url, timeout=timeout_sec)
            if resp.status_code == 200:
                manifest = resp.json()
                packs = manifest.get("packs", {})
                for lang_key, pack_info in packs.items():
                    norm_lang = normalize_language_code(lang_key)
                    lang_file = os.path.join(self.cache_dir, f"{norm_lang}.json")
                    remote_version = pack_info.get("version", "1.0.0")
                    download_url = pack_info.get("url")

                    # Check if local file exists and matches version
                    local_version = None
                    if os.path.exists(lang_file):
                        try:
                            with open(lang_file, "r", encoding="utf-8") as f:
                                local_data = json.load(f)
                                if isinstance(local_data, dict):
                                    local_version = local_data.get("__version__")
                        except Exception:
                            local_version = None

                    if local_version != remote_version and download_url:
                        pack_resp = await asyncio.to_thread(httpx_client.get, download_url, timeout=timeout_sec)
                        if pack_resp.status_code == 200:
                            content = pack_resp.json()
                            if isinstance(content, dict):
                                content["__version__"] = remote_version
                            tmp_file = f"{lang_file}.tmp-{os.getpid()}"
                            with open(tmp_file, "w", encoding="utf-8") as f:
                                json.dump(content, f, ensure_ascii=False, indent=2)
                            os.replace(tmp_file, lang_file)
                            updated_langs.append(norm_lang)
                            logger.info(f"Updated vocabulary pack for language '{norm_lang}' to version {remote_version}")
                        else:
                            current_langs.append(norm_lang)
                    else:
                        current_langs.append(norm_lang)

                # Refresh in-memory vocab cache
                vocab_mgr = get_vocab_manager()
                vocab_mgr._load_cached_vocabularies()

                return {
                    "status": "success",
                    "updated_languages": updated_langs,
                    "active_languages": list(set(current_langs + updated_langs)),
                    "message": f"Synchronized {len(updated_langs)} vocabulary updates."
                }
            else:
                logger.info(f"Vocabulary sync manifest returned status {resp.status_code}; using local caches.")
                return {
                    "status": "cached",
                    "updated_languages": [],
                    "message": "Remote manifest not available, using local vocabulary cache."
                }
        except Exception as e:
            logger.info(f"Vocabulary sync offline or completed gracefully: {e}")
            return {
                "status": "offline",
                "updated_languages": [],
                "message": "Offline or network timeout, running with local and bundled vocabulary."
            }

_VOCAB_SYNC_SERVICE: Optional[VocabSyncService] = None

def get_vocab_sync_service() -> VocabSyncService:
    global _VOCAB_SYNC_SERVICE
    if _VOCAB_SYNC_SERVICE is None:
        _VOCAB_SYNC_SERVICE = VocabSyncService()
    return _VOCAB_SYNC_SERVICE

async def background_vocab_sync_startup() -> None:
    """Startup background worker for vocabulary update check."""
    service = get_vocab_sync_service()
    await service.sync_vocabularies(timeout_sec=2.5)
