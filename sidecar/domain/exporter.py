import os
import base64
import datetime
import html
import pymupdf
from typing import Dict, Any, List
from sidecar.config import EXPORT_DIR, logger

def _render_pdf_from_markdown(markdown_content: str, output_path: str):
    """Render existing Markdown blocks with Unicode fallback and flowing pages."""
    blocks = []
    code_lines = None
    for raw_line in markdown_content.splitlines():
        line = raw_line.rstrip()
        if line.strip().startswith("```"):
            if code_lines is None:
                code_lines = []
            else:
                blocks.append("<pre>" + html.escape("\n".join(code_lines)) + "</pre>")
                code_lines = None
            continue
        if code_lines is not None:
            code_lines.append(line)
            continue
        if not line.strip():
            continue
        if line.startswith(("# ", "## ", "### ")):
            level = len(line.split(" ", 1)[0])
            blocks.append(f"<h{level}>{html.escape(line[level + 1:])}</h{level}>")
        elif line.startswith(("* ", "- ")):
            blocks.append("<p>• " + html.escape(line[2:]) + "</p>")
        elif line.strip().startswith("|") and line.strip().endswith("|"):
            cells = [cell.strip() for cell in line.strip().split("|")[1:-1]]
            if not all(set(cell) <= {"-", ":", " "} for cell in cells if cell):
                blocks.append('<p class="table-row">' + html.escape("  |  ".join(cells)) + "</p>")
        else:
            blocks.append("<p>" + html.escape(line) + "</p>")
    if code_lines is not None:
        blocks.append("<pre>" + html.escape("\n".join(code_lines)) + "</pre>")

    story = pymupdf.Story("".join(blocks), em=10, user_css="""
        body { font-family: sans-serif; color: #1a1a1a; }
        h1, h2, h3 { color: #193b66; }
        p { margin: 0 0 6pt; }
        pre { white-space: pre-wrap; font-size: 9pt; background: #f2f2f7; }
        .table-row { background: #f5f5f5; }
    """)
    media = pymupdf.Rect(0, 0, 595, 842)

    def next_page(number, filled):
        if number > 0 and pymupdf.Rect(filled).is_empty:
            raise RuntimeError("PDF content cannot fit a page.")
        return media, media + (40, 40, -40, -40), None

    with story.write_with_links(next_page) as document:
        document.save(output_path, deflate=True, garbage=4, clean=True,
                      deflate_images=True, deflate_fonts=True)


def _render_docx_from_markdown(markdown_content: str, output_path: str):
    """Compiles Markdown content to DOCX Word document maintaining headings, lists, tables, and formatting."""
    import docx
    from docx.shared import Pt, RGBColor
    from docx.enum.text import WD_ALIGN_PARAGRAPH

    doc = docx.Document()
    
    # Configure page margins
    sections = doc.sections
    for section in sections:
        section.top_margin = docx.shared.Inches(0.75)
        section.bottom_margin = docx.shared.Inches(0.75)
        section.left_margin = docx.shared.Inches(0.75)
        section.right_margin = docx.shared.Inches(0.75)

    lines = markdown_content.splitlines()
    in_code_block = False
    code_block_lines: List[str] = []
    table_rows_buffer: List[List[str]] = []

    def flush_table_buffer():
        nonlocal table_rows_buffer
        if not table_rows_buffer:
            return
        
        cols_count = max(len(r) for r in table_rows_buffer)
        table = doc.add_table(rows=len(table_rows_buffer), cols=cols_count)
        table.style = 'Table Grid'
        
        for r_idx, row in enumerate(table_rows_buffer):
            for c_idx, cell_value in enumerate(row):
                if c_idx < cols_count:
                    cell = table.cell(r_idx, c_idx)
                    cell.text = cell_value
                    if r_idx == 0:
                        # Bold table headers
                        for p in cell.paragraphs:
                            for run in p.runs:
                                run.font.bold = True
        table_rows_buffer = []

    for raw_line in lines:
        line = raw_line.rstrip()

        # Handle Code Blocks
        if line.strip().startswith("```"):
            if in_code_block:
                flush_table_buffer()
                code_text = "\n".join(code_block_lines)
                code_block_lines = []
                in_code_block = False
                
                p = doc.add_paragraph()
                p.paragraph_format.left_indent = Pt(12)
                p.paragraph_format.space_before = Pt(6)
                p.paragraph_format.space_after = Pt(6)
                run = p.add_run(code_text)
                run.font.name = 'Consolas'
                run.font.size = Pt(9.5)
                run.font.color.rgb = RGBColor(40, 40, 40)
            else:
                flush_table_buffer()
                in_code_block = True
            continue

        if in_code_block:
            code_block_lines.append(line)
            continue

        # Handle Markdown Tables
        if line.strip().startswith("|") and line.strip().endswith("|"):
            parts = [p.strip() for p in line.strip().split("|")[1:-1]]
            if all(set(p) <= {"-", ":", " "} for p in parts if p):
                continue
            table_rows_buffer.append(parts)
            continue
        else:
            flush_table_buffer()

        if not line.strip():
            continue

        # Headings and Text Formatting
        if line.startswith("# "):
            h = doc.add_heading(line[2:].strip(), level=1)
            h.paragraph_format.space_before = Pt(12)
            h.paragraph_format.space_after = Pt(6)
        elif line.startswith("## "):
            h = doc.add_heading(line[3:].strip(), level=2)
            h.paragraph_format.space_before = Pt(10)
            h.paragraph_format.space_after = Pt(4)
        elif line.startswith("### "):
            h = doc.add_heading(line[4:].strip(), level=3)
            h.paragraph_format.space_before = Pt(8)
            h.paragraph_format.space_after = Pt(2)
        elif line.startswith("* ") or line.startswith("- "):
            p = doc.add_paragraph(style='List Bullet')
            p.add_run(line[2:].strip())
        else:
            p = doc.add_paragraph()
            p.paragraph_format.space_after = Pt(4)
            p.add_run(line.strip())

    flush_table_buffer()
    doc.save(output_path)


def export_markdown_to_file(markdown_content: str, export_format: str = "pdf") -> Dict[str, Any]:
    """Compiles Markdown into structured PDF, DOCX, HTML, or raw MD file preserving original layout."""
    fmt = export_format.lower().strip()
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")

    if fmt == "pdf":
        export_filename = f"export_{ts}.pdf"
        file_path = os.path.join(EXPORT_DIR, export_filename)
        try:
            _render_pdf_from_markdown(markdown_content, file_path)
            with open(file_path, "rb") as f:
                b64_content = base64.b64encode(f.read()).decode("utf-8")

            return {
                "status": "success",
                "format": "pdf",
                "file_name": export_filename,
                "file_path": file_path,
                "base64_content": b64_content,
                "message": f"Successfully compiled markdown into PDF format: {export_filename}"
            }
        except Exception as e:
            logger.error(f"Failed PDF compilation in sidecar exporter: {e}")
            raise RuntimeError(f"PDF export failed: {str(e)}")

    elif fmt == "docx":
        export_filename = f"export_{ts}.docx"
        file_path = os.path.join(EXPORT_DIR, export_filename)
        try:
            _render_docx_from_markdown(markdown_content, file_path)
            with open(file_path, "rb") as f:
                b64_content = base64.b64encode(f.read()).decode("utf-8")

            return {
                "status": "success",
                "format": "docx",
                "file_name": export_filename,
                "file_path": file_path,
                "base64_content": b64_content,
                "message": f"Successfully compiled markdown into DOCX format: {export_filename}"
            }
        except Exception as e:
            logger.error(f"Failed DOCX compilation in sidecar exporter: {e}")
            raise RuntimeError(f"DOCX export failed: {str(e)}")

    elif fmt in ["html", "htm"]:
        export_filename = f"export_{ts}.html"
        file_path = os.path.join(EXPORT_DIR, export_filename)
        try:
            html_wrapper = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Exported Document</title>
    <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; max-width: 850px; margin: 40px auto; padding: 0 20px; color: #1e293b; background: #0f172a; color: #f8fafc; }}
        h1, h2, h3 {{ color: #38bdf8; }}
        pre {{ background: #1e293b; padding: 16px; border-radius: 8px; overflow-x: auto; font-family: monospace; }}
        table {{ border-collapse: collapse; width: 100%; margin: 16px 0; }}
        th, td {{ border: 1px solid #334155; padding: 8px 12px; text-align: left; }}
        th {{ background: #1e293b; color: #38bdf8; }}
    </style>
</head>
<body>
    <pre>{markdown_content}</pre>
</body>
</html>"""
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(html_wrapper)

            with open(file_path, "rb") as f:
                b64_content = base64.b64encode(f.read()).decode("utf-8")

            return {
                "status": "success",
                "format": "html",
                "file_name": export_filename,
                "file_path": file_path,
                "base64_content": b64_content,
                "message": f"Successfully exported HTML document: {export_filename}"
            }
        except Exception as e:
            logger.error(f"Failed HTML export in sidecar exporter: {e}")
            raise RuntimeError(f"HTML export failed: {str(e)}")

    else:
        export_filename = f"export_{ts}.md"
        file_path = os.path.join(EXPORT_DIR, export_filename)
        try:
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(markdown_content)

            with open(file_path, "rb") as f:
                b64_content = base64.b64encode(f.read()).decode("utf-8")

            return {
                "status": "success",
                "format": fmt,
                "file_name": export_filename,
                "file_path": file_path,
                "base64_content": b64_content,
                "message": f"Successfully exported markdown file: {export_filename}"
            }
        except Exception as e:
            logger.error(f"Failed file export in sidecar exporter: {e}")
            raise RuntimeError(f"Export failed: {str(e)}")
