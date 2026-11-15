import io
import tempfile
import unittest
from pathlib import Path

from ai_assistant import documents
from ai_assistant.service import AssistantService


class DocumentsTest(unittest.TestCase):
    def test_plain_text_and_code(self):
        text, meta = documents.extract('notes.md', '# 标题\n内容'.encode('utf-8'))
        self.assertIn('标题', text)
        self.assertEqual(meta['kind'], 'text')
        code, _ = documents.extract('main.py', b'print(1)\n')
        self.assertEqual(code.strip(), 'print(1)')

    def test_gbk_text(self):
        text, _ = documents.extract('a.txt', '中文内容'.encode('gb18030'))
        self.assertIn('中文内容', text)

    def test_docx(self):
        import docx
        document = docx.Document()
        document.add_paragraph('第一段')
        table = document.add_table(rows=1, cols=2)
        table.cell(0, 0).text = 'A'
        table.cell(0, 1).text = 'B'
        buffer = io.BytesIO()
        document.save(buffer)
        text, meta = documents.extract('report.docx', buffer.getvalue())
        self.assertIn('第一段', text)
        self.assertIn('A | B', text)
        self.assertEqual(meta['kind'], 'docx')

    def test_xlsx(self):
        from openpyxl import Workbook
        workbook = Workbook()
        workbook.active.append(['列1', '列2'])
        workbook.active.append([1, 2])
        buffer = io.BytesIO()
        workbook.save(buffer)
        text, meta = documents.extract('table.xlsx', buffer.getvalue())
        self.assertIn('列1', text)
        self.assertEqual(meta['kind'], 'xlsx')

    def test_rejects_unsupported_and_empty(self):
        with self.assertRaises(documents.DocumentError):
            documents.extract('a.exe', b'MZ')
        with self.assertRaises(documents.DocumentError):
            documents.extract('empty.txt', b'')
        with self.assertRaises(documents.DocumentError):
            documents.extract('old.doc', b'xxx')


class ChatFileStoreTest(unittest.TestCase):
    def test_save_and_load(self):
        with tempfile.TemporaryDirectory() as folder:
            service = AssistantService(Path(folder) / 'assistant.sqlite3')
            summary = service.save_document('说明.txt', '这是资料'.encode('utf-8'))
            self.assertEqual(summary['kind'], 'text')
            record = service.load_document(summary['id'])
            self.assertEqual(record['text'], '这是资料')
            self.assertIsNone(service.load_document('../../etc/passwd'))
            self.assertIsNone(service.load_document('0' * 32))


if __name__ == '__main__':
    unittest.main()
