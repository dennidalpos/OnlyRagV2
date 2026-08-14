import os
import sys
import logging
import requests
from typing import List

# Setup logging
logging.basicConfig(level=logging.INFO, format="[%(asctime)s] [%(levelname)s] [PythonSidecar]: %(message)s")
logger = logging.getLogger("PythonSidecar")

ALLOWED_ORIGINS: List[str] = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "app://-",
    "vscode-webview://"
]

# Persistent User Data Storage directory
USER_DATA = os.environ.get("ONLYRAG_DATA_DIR")
if not USER_DATA:
    if sys.platform == "win32":
        USER_DATA = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "OnlyRagV2")
    else:
        USER_DATA = os.path.join(os.path.expanduser("~"), ".onlyragv2")

DATA_DIR = os.path.join(USER_DATA, "data")
LANCEDB_DIR = os.path.join(DATA_DIR, "lancedb_store")
EXPORT_DIR = os.path.join(DATA_DIR, "exports")

os.makedirs(LANCEDB_DIR, exist_ok=True)
os.makedirs(EXPORT_DIR, exist_ok=True)

EMBEDDING_DIM: int = 768
DOCS_TABLE_NAME: str = "documents"
CHUNKS_TABLE_NAME: str = "chunks"

try:
    import httpx
    HAS_HTTPX = True
    httpx_client: httpx.Client | None = httpx.Client(timeout=10.0)
except ImportError:
    HAS_HTTPX = False
    httpx_client = None

http_session = requests.Session()
