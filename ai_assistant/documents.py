"""Extract plain text from uploaded documents so the chat can read them.

Only text-bearing formats are supported: PDF (text layer), Word, Excel, and
plain-text/code files. Scanned PDFs and images need OCR or a vision model and
are rejected with a clear message instead of returning empty text.
"""
from __future__ import annotations

import io
from pathlib import Path

MAX_BYTES = 10 * 1024 * 1024
MAX_STORED = 400_000
MAX_PROMPT = 20_000
MAX_PDF_PAGES = 300

TEXT_SUFFIXES = {
    '.txt', '.md', '.markdown', '.log', '.json', '.yaml', '.yml', '.csv', '.tsv',
    '.py', '.js', '.mjs', '.ts', '.tsx', '.jsx', '.java', '.c', '.cpp', '.h', '.go',
    '.rs', '.sql', '.sh', '.bat', '.ps1', '.ini', '.toml', '.conf', '.html', '.htm', '.xml',
}


class DocumentError(ValueError):
    def __init__(self, message, code='invalid_document'):
        super().__init__(message)
        self.code = message and code


def _decode(raw):
    for encoding in ('utf-8-sig', 'gb18030', 'utf-16'):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise DocumentError('无法识别文件编码，请另存为 UTF-8 后重试。', 'invalid_encoding')


def _pdf(raw):
    try:
        from pypdf import PdfReader
    except ImportError:
        raise DocumentError('服务端缺少 PDF 解析组件。', 'parser_missing')
    try:
        reader = PdfReader(io.BytesIO(raw))
    except Exception:
        raise DocumentError('无法解析该 PDF，文件可能已损坏或加密。', 'invalid_pdf')
    pages = list(reader.pages)[:MAX_PDF_PAGES]
    chunks = []
    empty = 0
    for index, page in enumerate(pages, start=1):
        try:
            text = (page.extract_text() or '').strip()
        except Exception:
            text = ''
        if text:
            chunks.append(f'[第 {index} 页]\n{text}')
        else:
            empty += 1
    if not chunks:
        raise DocumentError('这个 PDF 没有可提取的文字（可能是扫描件或图片版），暂不支持。', 'pdf_no_text')
    note = ''
    if empty:
        note = f'（{empty} 页无可提取文字，可能为图片）'
    return '\n\n'.join(chunks), dict(pages=len(pages), kind='pdf', note=note)


def _docx(raw):
    try:
        import docx
    except ImportError:
        raise DocumentError('服务端缺少 Word 解析组件。', 'parser_missing')
    try:
        document = docx.Document(io.BytesIO(raw))
    except Exception:
        raise DocumentError('无法解析该 Word 文件，请确认是 .docx 格式。', 'invalid_docx')
    blocks = [paragraph.text.strip() for paragraph in document.paragraphs if paragraph.text.strip()]
    for table in document.tables:
        for row in table.rows:
            cells = [cell.text.strip() for cell in row.cells]
            if any(cells):
                blocks.append(' | '.join(cells))
    if not blocks:
        raise DocumentError('这个 Word 文件没有可提取的文字。', 'docx_empty')
    return '\n'.join(blocks), dict(pages=None, kind='docx', note='')


def _xlsx(raw):
    try:
        from openpyxl import load_workbook
    except ImportError:
        raise DocumentError('服务端缺少 Excel 解析组件。', 'parser_missing')
    try:
        workbook = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    except Exception:
        raise DocumentError('无法解析该 Excel 文件，请确认是 .xlsx 格式。', 'invalid_xlsx')
    try:
        sheet = workbook[workbook.sheetnames[0]]
        lines = []
        for row in sheet.iter_rows(values_only=True):
            values = ['' if cell is None else str(cell) for cell in row]
            if any(value.strip() for value in values):
                lines.append('\t'.join(values).rstrip())
            if len(lines) > 5000:
                break
    finally:
        workbook.close()
    if not lines:
        raise DocumentError('这个 Excel 第一个工作表是空的。', 'xlsx_empty')
    return '\n'.join(lines), dict(pages=None, kind='xlsx', note=f'共 {len(workbook.sheetnames)} 个工作表，仅读取第一个')


def extract(name, raw):
    """Return (text, meta) for one upload; raises DocumentError when unsupported."""
    if not isinstance(raw, bytes) or not raw:
        raise DocumentError('文件为空。', 'empty_file')
    if len(raw) > MAX_BYTES:
        raise DocumentError('文件超过 10MB 限制。', 'file_too_large')
    suffix = Path(name or '').suffix.lower()
    if suffix == '.pdf':
        text, meta = _pdf(raw)
    elif suffix in ('.docx', '.docm'):
        text, meta = _docx(raw)
    elif suffix in ('.xlsx', '.xlsm'):
        text, meta = _xlsx(raw)
    elif suffix in TEXT_SUFFIXES:
        text, meta = _decode(raw), dict(pages=None, kind='text', note='')
    elif suffix == '.doc':
        raise DocumentError('暂不支持旧版 .doc，请另存为 .docx。', 'unsupported_format')
    else:
        raise DocumentError('暂不支持该文件类型。可读取 PDF、Word(.docx)、Excel(.xlsx) 和文本/代码文件。', 'unsupported_format')
    text = text.strip()
    if not text:
        raise DocumentError('文件没有可读内容。', 'empty_text')
    truncated = len(text) > MAX_STORED
    return text[:MAX_STORED], dict(meta, chars=len(text), truncated=truncated, stored_chars=min(len(text), MAX_STORED))
