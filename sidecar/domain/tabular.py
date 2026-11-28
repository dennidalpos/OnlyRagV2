"""Shared bounded table rendering; no Sidecar runtime or persistent storage imports."""
import pandas as pd

EXCEL_RAG_MAX_COLUMNS = 128
EXCEL_RAG_MAX_CELL_CHARS = 256
TABULAR_MAX_COLUMNS = 256
TABULAR_MAX_CELL_CHARS = 64 * 1024
TABULAR_MAX_ROW_CHARS = 128 * 1024
TABULAR_MAX_RENDER_CHARS = 4 * 1024 * 1024


def _check_tabular_row(row, source, max_columns=TABULAR_MAX_COLUMNS):
    if max_columns is not None and len(row) > max_columns:
        raise ValueError(f"{source} row exceeds the {max_columns}-column parser limit.")
    size = 0
    for value in row:
        if value is None:
            continue
        length = len(str(value))
        if length > TABULAR_MAX_CELL_CHARS:
            raise ValueError(f"{source} cell exceeds the {TABULAR_MAX_CELL_CHARS}-character parser limit.")
        size += length
        if size > TABULAR_MAX_ROW_CHARS:
            raise ValueError(f"{source} row exceeds the {TABULAR_MAX_ROW_CHARS}-character parser limit.")
    return size



def _extract_full_format_excel_sheet(sheet_name, rows, max_row, max_column, limit_rows):
    retained = []
    columns = []
    seen_columns = set()
    omitted_columns = set()
    nonempty_rows = 0
    shortened_cells = 0
    for row_number, row in rows:
        _check_tabular_row(row, "Excel", max_columns=None)
        if row_number > max_row:
            raise ValueError(f"Excel row {row_number} exceeds the format limit of {max_row}.")
        selected = {"Row": row_number}
        has_value = False
        for column_number, value in enumerate(row, start=1):
            if column_number > max_column:
                raise ValueError(f"Excel column {column_number} exceeds the format limit of {max_column}.")
            if value is None or value == "":
                continue
            has_value = True
            if column_number not in seen_columns:
                seen_columns.add(column_number)
                if nonempty_rows < limit_rows and len(columns) < EXCEL_RAG_MAX_COLUMNS:
                    columns.append(column_number)
                else:
                    omitted_columns.add(column_number)
            if nonempty_rows < limit_rows and column_number in columns:
                cell = str(value)
                if len(cell) > EXCEL_RAG_MAX_CELL_CHARS:
                    cell = cell[:EXCEL_RAG_MAX_CELL_CHARS]
                    shortened_cells += 1
                selected[f"Col {column_number}"] = cell
        if has_value:
            nonempty_rows += 1
            if len(retained) < limit_rows:
                retained.append(selected)
    if not retained:
        return None
    frame = pd.DataFrame(retained, columns=["Row", *(f"Col {column}" for column in columns)]).fillna("")
    result = f"### Foglio: {sheet_name}\n\n{frame.to_markdown(tablefmt='pipe', index=False, disable_numparse=True)}"
    result += (f"\n\n> [!NOTE]\n> Estratto RAG: prime {len(retained)} righe non vuote su {nonempty_rows}; "
               f"prime {len(columns)} colonne non vuote su {len(seen_columns)}. "
               "Row e Col indicano le coordinate originali. Il file originale è conservato.")
    if omitted_columns:
        result += f"\n> Colonne omesse dall'estratto: {len(omitted_columns)}."
    if shortened_cells:
        result += f"\n> Celle abbreviate a {EXCEL_RAG_MAX_CELL_CHARS} caratteri: {shortened_cells}."
    return result
