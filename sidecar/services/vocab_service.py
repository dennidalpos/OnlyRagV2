import asyncio
import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

from sidecar.config import logger
from sidecar.domain.word_segmenter import get_vocab_manager, normalize_language_code


_DEFAULT_BUNDLED_VOCAB_DIR = Path(__file__).resolve().parents[1] / "assets" / "vocab"


class VocabSyncService:
    """Keep the local vocabulary cache aligned with the packs bundled with the Sidecar (no network access)."""

    def __init__(
        self,
        cache_dir: Optional[str] = None,
        bundled_vocab_dir: Optional[str] = None,
    ):
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

    def _cached_languages(self) -> List[Path]:
        return sorted(Path(self.cache_dir).glob("*.json"), key=lambda item: item.name)

    def sync_vocabularies(self) -> Dict[str, Any]:
        """Apply newer bundled vocabulary packs to the cache atomically."""
        self._ensure_cache_dir()
        updated_languages: List[str] = []

        try:
            manifest = self._load_bundled_manifest()
            packs = manifest.get("packs", {})
            if not isinstance(packs, dict):
                raise ValueError("Vocabulary manifest 'packs' must be a JSON object.")

            for language, pack_info in packs.items():
                if not isinstance(pack_info, dict):
                    continue
                normalized_language = normalize_language_code(language)
                pack_url = pack_info.get("url")
                pack_version = str(pack_info.get("version", "1.0.0"))
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
                if local_version == pack_version:
                    continue

                content = self._load_bundled_pack(pack_url)
                content["__version__"] = pack_version
                temporary_file = language_file.with_name(f"{language_file.name}.tmp-{os.getpid()}")
                try:
                    temporary_file.write_text(json.dumps(content, ensure_ascii=False, indent=2), encoding="utf-8")
                    os.replace(temporary_file, language_file)
                finally:
                    temporary_file.unlink(missing_ok=True)
                updated_languages.append(normalized_language)
                logger.info("Updated vocabulary pack '%s' to version %s from bundled assets.", normalized_language, pack_version)

            get_vocab_manager()._load_cached_vocabularies()
            active_languages = [item.stem for item in self._cached_languages()]
            return {
                "status": "bundled",
                "source": "bundled",
                "updated_languages": updated_languages,
                "active_languages": active_languages,
                "message": f"Synchronized {len(updated_languages)} vocabulary updates from bundled assets.",
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
    await asyncio.to_thread(get_vocab_sync_service().sync_vocabularies)
