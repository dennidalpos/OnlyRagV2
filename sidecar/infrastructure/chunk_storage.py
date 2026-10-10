"""Arrow schema and verified provenance shared by ingestion and rebuild."""
from typing import Any
import pyarrow as pa
from sidecar.infrastructure.embeddings import EmbeddingSpace, EmbeddingSpaceMismatchError

_SPACE_FIELDS = tuple(EmbeddingSpace.__dataclass_fields__)
CHUNK_PROVENANCE_FIELDS = (*_SPACE_FIELDS, "embedding_space_id")


def chunk_embedding_space(row: dict) -> EmbeddingSpace:
    try:
        space = EmbeddingSpace(**{key: row[key] for key in _SPACE_FIELDS})
        if (type(space.embedding_dimension) is not int or space.embedding_dimension <= 0
                or any(not isinstance(row[key], str) or not row[key] for key in _SPACE_FIELDS if key != "embedding_dimension")
                or space.metadata()["embedding_space_id"] != row["embedding_space_id"]):
            raise ValueError("Invalid embedding provenance.")
        return space
    except (KeyError, TypeError, ValueError) as err:
        raise EmbeddingSpaceMismatchError("Unversioned or malformed chunk provenance; explicitly rebuild from preserved Markdown with verified backup/readback/rollback.") from err


def chunk_schema(dimension: int) -> pa.Schema:
    strings = ["chunk_id", "doc_id", "doc_name", "text", "section_header", "file_type", "ingested_at",
               *[key for key in CHUNK_PROVENANCE_FIELDS if key != "embedding_dimension"]]
    return pa.schema([
        pa.field("vector", pa.list_(pa.float32(), dimension), nullable=False),
        pa.field("chunk_index", pa.int64(), nullable=False),
        pa.field("embedding_dimension", pa.int32(), nullable=False),
        *[pa.field(key, pa.string(), nullable=False) for key in strings],
    ])


def require_versioned_chunk_table(table: Any) -> int:
    if not set(CHUNK_PROVENANCE_FIELDS).issubset(table.schema.names):
        raise EmbeddingSpaceMismatchError("Legacy index has no verified embedding-space provenance; preserve documents and explicitly rebuild with verified backup/readback/rollback.")
    vector_type = table.schema.field("vector").type
    if not pa.types.is_fixed_size_list(vector_type) or not pa.types.is_float32(vector_type.value_type):
        raise EmbeddingSpaceMismatchError("Incompatible vector schema; an explicit backed-up rebuild is required.")
    return vector_type.list_size
