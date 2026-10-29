"""Read existing Word stories without materializing parts or hiding visible text."""
import xml.etree.ElementTree as ET

from docx.oxml.ns import qn
from docx.opc.constants import RELATIONSHIP_TYPE as RT
from docx.text.paragraph import Paragraph


def docx_stories(doc):
    stories = [(doc.element.body, doc)]
    seen_parts = {doc.part.partname}
    for relation in doc.part.rels.values():
        if relation.reltype in (RT.HEADER, RT.FOOTER) and not relation.is_external:
            part = relation.target_part
            if part.partname not in seen_parts:
                stories.append((part.element, part))
                seen_parts.add(part.partname)

    unsupported = {qn(f"w:{tag}") for tag in (
        "txbxContent", "altChunk", "subDoc", "fldSimple", "fldChar", "instrText",
        "footnoteReference", "endnoteReference", "commentReference", "sdt", "sym",
        "del", "ins", "moveFrom", "moveTo",
    )}
    unsupported.update({qn("m:oMath"), qn("m:oMathPara"), qn("c:chart"), qn("dgm:relIds")})
    for root, _ in stories:
        for element in root.iter():
            if element.tag in unsupported or element.tag == qn("a:t") or element.get("string"):
                raise ValueError(f"Unsupported DOCX content: {element.tag.split('}')[-1]}; no document was exported")

    for part in doc.part.package.parts:
        if part.partname in seen_parts or not str(part.partname).startswith("/word/") or not part.content_type.endswith("xml"):
            continue
        root = ET.fromstring(part.blob)
        if any(element.tag in (qn("w:t"), qn("a:t")) and (element.text or "").strip() for element in root.iter()):
            raise ValueError(f"Unsupported DOCX text part: {part.partname}; no document was exported")
    return stories


def _blocks(root, doc):
    blocks = []
    for element in root:
        if element.tag == qn("w:p"):
            # Paragraph.text includes runs/hyperlinks, but does not read arbitrary wrappers.
            for text in element.iter(qn("w:t")):
                run = text.getparent()
                parent = run.getparent()
                if run.tag != qn("w:r") or not (parent is element or (
                        parent.tag == qn("w:hyperlink") and parent.getparent() is element)):
                    raise ValueError("Unsupported DOCX inline text container; no indexing performed")
            paragraph = Paragraph(element, doc)
            text = paragraph.text.strip()
            if text:
                style = (paragraph.style.name if paragraph.style else "").lower()
                level = next((level for level in (1, 2, 3) if style == f"heading {level}"), 0)
                blocks.append(f"{'#' * level} {text}" if level else text)
        elif element.tag == qn("w:tbl"):
            rows = []
            for row in element.findall(qn("w:tr")):
                cells = []
                for cell in row.findall(qn("w:tc")):
                    merge = cell.find(f"{qn('w:tcPr')}/{qn('w:vMerge')}")
                    if merge is not None and merge.get(qn("w:val")) != "restart":
                        # A continuation is not a second occurrence of the merged cell.
                        if any((text.text or "").strip() for text in cell.iter(qn("w:t"))):
                            raise ValueError("Unsupported DOCX text in a merged-cell continuation")
                        cells.append("")
                    else:
                        cells.append("<br><br>".join(_blocks(cell, doc)).replace("|", "\\|").replace("\n", "<br>"))
                if any(cells):
                    rows.append(cells)
            if rows:
                width = max(map(len, rows))
                lines = ["| " + " | ".join(row + [""] * (width - len(row))) + " |" for row in rows]
                lines.insert(1, "| " + " | ".join(["---"] * width) + " |")
                blocks.append("\n".join(lines))
        elif element.tag not in {qn("w:sectPr"), qn("w:tcPr")}:
            if any((node.text or "").strip() for node in element.iter(qn("w:t"))):
                raise ValueError(f"Unsupported DOCX block: {element.tag.split('}')[-1]}; no indexing performed")
    return blocks


def extract_docx_blocks(doc):
    stories = docx_stories(doc)
    for root, _ in stories:
        for paragraph in root.iter(qn("w:p")):
            parent = paragraph.getparent()
            if parent is not root and parent.tag != qn("w:tc"):
                raise ValueError("Unsupported DOCX block container; no indexing performed")
            while parent is not root:
                owner = parent.getparent()
                allowed = {qn("w:tc"): {qn("w:tr")}, qn("w:tr"): {qn("w:tbl")},
                           qn("w:tbl"): {qn("w:tc"), root.tag}}
                if parent.tag not in allowed or owner is None or owner.tag not in allowed[parent.tag]:
                    raise ValueError("Unsupported DOCX block container; no indexing performed")
                parent = owner
        for text in root.iter(qn("w:t")):
            if not any(parent.tag == qn("w:p") for parent in text.iterancestors()):
                raise ValueError("Unsupported DOCX text outside a paragraph; no indexing performed")
    # Header/footer parts have no unique body position or page mapping. Include each once.
    headers = [root for root, _ in stories if root.tag == qn("w:hdr")]
    footers = [root for root, _ in stories if root.tag == qn("w:ftr")]
    return [block for root in (*headers, doc.element.body, *footers) for block in _blocks(root, doc)]
