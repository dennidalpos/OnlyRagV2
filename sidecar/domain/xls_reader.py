"""XLS materialization, imported only inside the contained parser process."""
import pandas as pd
from sidecar.domain.tabular import (
    TABULAR_MAX_COLUMNS, TABULAR_MAX_RENDER_CHARS,
    _check_tabular_row, _extract_full_format_excel_sheet,
)


def _xls_rows(sheet, datemode):
    from xlrd import XL_CELL_DATE, xldate_as_datetime

    for row_number in range(sheet.nrows):
        yield row_number + 1, [
            xldate_as_datetime(cell.value, datemode) if cell.ctype == XL_CELL_DATE else cell.value
            for cell in sheet.row(row_number)
        ]



def extract_xls_document(file_path, limit_excel_rows, limit_sheets, allow_full_excel_format):
    excel_source = file_path
    with pd.ExcelFile(excel_source, engine="xlrd", engine_kwargs={"on_demand": True, "ragged_rows": True}) as xls:
        sheets_output = []
        skipped_sheets = 0
        total_sheets_count = len(xls.sheet_names)
        processed_sheets = xls.sheet_names[:limit_sheets]

        for sheet_name in processed_sheets:
            if allow_full_excel_format:
                sheet = xls.book.sheet_by_name(sheet_name)
                try:
                    if sheet.nrows > 65_536 or sheet.ncols > 256:
                        raise ValueError("XLS worksheet exceeds the 65,536-row or 256-column format limit.")
                    sheet_md = _extract_full_format_excel_sheet(
                        sheet_name,
                        _xls_rows(sheet, xls.book.datemode),
                        65_536, 256, limit_excel_rows,
                    )
                    if sheet_md:
                        sheets_output.append(sheet_md)
                    else:
                        skipped_sheets += 1
                finally:
                    xls.book.unload_sheet(sheet_name)
                continue
            sheet = xls.book.sheet_by_name(sheet_name)
            try:
                if sheet.ncols > TABULAR_MAX_COLUMNS:
                    raise ValueError(f"Excel exceeds the {TABULAR_MAX_COLUMNS}-column parser limit.")
                retained_rows = []
                total_sheet_rows = 0
                retained_chars = 0
                for row_number, row in _xls_rows(sheet, xls.book.datemode):
                    row_chars = _check_tabular_row(row, "Excel")
                    if any(cell is not None and cell != "" for cell in row):
                        total_sheet_rows = row_number
                    if row_number <= limit_excel_rows:
                        retained_chars += row_chars
                        if retained_chars > TABULAR_MAX_RENDER_CHARS:
                            raise ValueError("Excel selected cells exceed the parser render limit.")
                        retained_rows.append(row)
            finally:
                xls.book.unload_sheet(sheet_name)
            retained_rows = retained_rows[:min(total_sheet_rows, limit_excel_rows)]
            if not retained_rows:
                skipped_sheets += 1
                continue
            df = pd.DataFrame(retained_rows).fillna("")
            if not any(str(cell).strip() for cell in df.to_numpy().flat):
                skipped_sheets += 1
                continue
            df.columns = [f"Col {i+1}" for i in range(len(df.columns))]
            md_table = df.to_markdown(tablefmt="pipe", index=False, disable_numparse=True) or ""

            sheet_md = f"### Foglio: {sheet_name}\n\n{md_table}"
            if total_sheet_rows > limit_excel_rows:
                sheet_md += f"\n\n> [!NOTE]\n> Tabella troncata a {limit_excel_rows} righe (su {total_sheet_rows} totali nel foglio '{sheet_name}').\n"
            sheets_output.append(sheet_md)

        if not sheets_output:
            raise ValueError("Excel extraction produced no readable cells in the selected sheets.")

        combined_excel_md = "\n\n".join(sheets_output)
        if skipped_sheets:
            combined_excel_md += f"\n\n> [!NOTE]\n> Fogli selezionati senza celle leggibili nel limite di righe: {skipped_sheets}.\n"
        if total_sheets_count > limit_sheets:
            combined_excel_md += f"\n\n> [!NOTE]\n> Mostrati i primi {len(processed_sheets)} fogli su {total_sheets_count} totali nella cartella Excel.\n"

        return [(1, combined_excel_md)]
