import asyncio
import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urljoin

from sidecar.config import httpx_client, logger
from sidecar.domain.word_segmenter import get_vocab_manager, normalize_language_code


_DEFAULT_VOCAB_MANIFEST_URL = "https://raw.githubusercontent.com/dennidalpos/OnlyRagV2/master/sidecar/assets/vocab/manifest.json"
_DEFAULT_BUNDLED_VOCAB_DIR = Path(__file__).resolve().parents[1] / "assets" / "vocab"


class VocabSyncService:
    """Keep local vocabulary supplements aligned with the remote or bundled manifest."""

    def __init__(
        self,
        manifest_url: str = _DEFAULT_VOCAB_MANIFEST_URL,
        cache_dir: Optional[str] = None,
        bundled_vocab_dir: Optional[str] = None,
    ):
        self.manifest_url = manifest_url
        appdata = os.environ.get("APPDATA") or os.path.expanduser("~/.onlyrag_v2")
        self.cache_dir = cache_dir or os.path.join(appdata, "onlyrag-v2", "vocab")
        self.bundled_vocab_dir = Path(bundled_vocab_dir) if bundled_vocab_dir else _DEFAULT_BUNDLED_VOCAB_DIR

    def _ensure_cache_dir(self) -> None:
        os.makedirs(self.cache_dir, exist_ok=True)

    def _load_bundled_manifest(self) -> Dict[str, Any]:
        manifest_path = self.bundled_vocab_dir / "manifest.json"
        with manifest_path.open("r", encoding="utf-8") as manifest_file:
            manifest = json.load(manifest_file)
        if not isinstance(manifest, dict):
            raise ValueError("Bundled vocabulary manifest must be a JSON object.")
        return manifest

    def _load_bundled_pack(self, relative_path: str) -> Dict[str, Any]:
        pack_path = (self.bundled_vocab_dir / relative_path).resolve()
        bundle_root = self.bundled_vocab_dir.resolve()
        if pack_path.parent != bundle_root:
            raise ValueError("Bundled vocabulary pack must stay inside the vocabulary asset directory.")
        with pack_path.open("r", encoding="utf-8") as pack_file:
            content = json.load(pack_file)
        if not isinstance(content, dict):
            raise ValueError("Vocabulary pack must be a JSON object.")
        return content

    async def _load_manifest(self, timeout_sec: float) -> Tuple[Dict[str, Any], str]:
        try:
            response = await asyncio.to_thread(httpx_client.get, self.manifest_url, timeout=timeout_sec)
            if response.status_code == 200:
                manifest = response.json()
                if not isinstance(manifest, dict):
                    raise ValueError("Remote vocabulary manifest must be a JSON object.")
                return manifest, "remote"
            logger.info("Vocabulary sync manifest returned status %s; using bundled packs.", response.status_code)
        except Exception as error:
            logger.info("Vocabulary sync is offline; using bundled packs: %s", error)
        return self._load_bundled_manifest(), "bundled"

    async def _load_pack(self, pack_url: str, source: str, timeout_sec: float) -> Dict[str, Any]:
        if source == "bundled":
            return self._load_bundled_pack(pack_url)

        response = await asyncio.to_thread(httpx_client.get, urljoin(self.manifest_url, pack_url), timeout=timeout_sec)
        if response.status_code != 200:
            raise RuntimeError(f"Vocabulary pack returned status {response.status_code}.")
        content = response.json()
        if not isinstance(content, dict):
            raise ValueError("Vocabulary pack must be a JSON object.")
        return content

    def _cached_languages(self) -> List[Path]:
        return sorted(Path(self.cache_dir).glob("*.json"), key=lambda item: item.name)

    async def sync_vocabularies(self, timeout_sec: float = 3.0, *, allow_remote: bool = True) -> Dict[str, Any]:
        """Apply newer vocabulary packs atomically without blocking offline startup."""
        self._ensure_cache_dir()
        updated_languages: List[str] = []

        try:
            manifest, source = await self._load_manifest(timeout_sec) if allow_remote else (self._load_bundled_manifest(), "bundled")
            packs = manifest.get("packs", {})
            if not isinstance(packs, dict):
                raise ValueError("Vocabulary manifest 'packs' must be a JSON object.")

            for language, pack_info in packs.items():
                if not isinstance(pack_info, dict):
                    continue
                normalized_language = normalize_language_code(language)
                pack_url = pack_info.get("url")
                remote_version = str(pack_info.get("version", "1.0.0"))
                if not isinstance(pack_url, str) or not pack_url.strip():
                    continue

                language_file = Path(self.cache_dir) / f"{normalized_language}.json"
                local_version = None
                if language_file.exists():
                    try:
                        local_content = json.loads(language_file.read_text(encoding="utf-8"))
                        if isinstance(local_content, dict):
                            local_version = local_content.get("__version__")
                    except (OSError, ValueError):
                        local_version = None
                if local_version == remote_version:
                    continue

                content = await self._load_pack(pack_url, source, timeout_sec)
                content["__version__"] = remote_version
                temporary_file = language_file.with_name(f"{language_file.name}.tmp-{os.getpid()}")
                try:
                    temporary_file.write_text(json.dumps(content, ensure_ascii=False, indent=2), encoding="utf-8")
                    os.replace(temporary_file, language_file)
                finally:
                    temporary_file.unlink(missing_ok=True)
                updated_languages.append(normalized_language)
                logger.info("Updated vocabulary pack '%s' to version %s from %s assets.", normalized_language, remote_version, source)

            get_vocab_manager()._load_cached_vocabularies()
            active_languages = [item.stem for item in self._cached_languages()]
            return {
                "status": "success" if source == "remote" else "bundled",
                "source": source,
                "updated_languages": updated_languages,
                "active_languages": active_languages,
                "message": f"Synchronized {len(updated_languages)} vocabulary updates from {source} assets.",
            }
        except Exception as error:
            logger.warning("Vocabulary synchronization failed; keeping existing cache: %s", error)
            return {
                "status": "cached" if self._cached_languages() else "offline",
                "source": "cache",
                "updated_languages": [],
                "active_languages": [item.stem for item in self._cached_languages()],
                "message": "Vocabulary synchronization failed; existing local cache was preserved.",
            }


_VOCAB_SYNC_SERVICE: Optional[VocabSyncService] = None


def get_vocab_sync_service() -> VocabSyncService:
    global _VOCAB_SYNC_SERVICE
    if _VOCAB_SYNC_SERVICE is None:
        _VOCAB_SYNC_SERVICE = VocabSyncService()
    return _VOCAB_SYNC_SERVICE


async def background_vocab_sync_startup() -> None:
    """Load bundled vocabulary without network access during startup."""
    await get_vocab_sync_service().sync_vocabularies(allow_remote=False)
