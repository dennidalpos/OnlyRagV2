"""Check an owned CPU candidate without Ollama requests or personal state."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


def sha256(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release-root', type=Path, required=True)
    args = parser.parse_args()
    release = args.release_root.resolve()
    if not release.is_relative_to(ROOT / 'release') or release == ROOT / 'release':
        parser.error('A retained repository release candidate is required.')
    manifest = json.loads((release / 'release-manifest.json').read_text(encoding='utf-8'))
    for item in manifest['files']:
        if sha256(release / item['path']) != item['sha256']:
            raise RuntimeError(f'Changed candidate file: {item["path"]}')
    probe = release / f'qualification-{uuid.uuid4().hex[:8]}'
    probe.mkdir()
    os.environ['ONLYRAG_DATA_DIR'] = str(probe / 'source-state')
    os.environ['OLLAMA_BASE_URL'] = 'http://127.0.0.1:9'
    from PIL import Image, ImageDraw, ImageFont
    from sidecar.infrastructure import ocr
    import onnxruntime
    import pymupdf

    fixture = Image.new('RGB', (1200, 180), 'white')
    font = ImageFont.truetype(str(ROOT / 'sidecar/assets/fonts/NotoSans-Regular.otf'), 52)
    ImageDraw.Draw(fixture).text((40, 45), 'ONLYRAG CPU 12345', fill='black', font=font)
    image_path = probe / 'ocr-input.png'
    fixture.save(image_path)
    output = ocr.run_rapid_ocr(image_path.read_bytes())
    (probe / 'ocr-output.txt').write_text(output, encoding='utf-8')
    if output.strip() != 'ONLYRAG CPU 12345' or ocr._rapidocr_cuda_available():
        raise RuntimeError(f'CPU OCR fixture failed: {output!r}')
    report = {'scope': 'Real CPU source OCR; frozen Sidecar startup/auth/PDF export. No Ollama calls. Not full restarted-desktop/RAG or arbitrary OCR qualification.',
              'sourceProviders': onnxruntime.get_available_providers(), 'ocrInputSha256': sha256(image_path), 'ocrOutput': output}

    with socket.socket() as guard:
        guard.bind(('127.0.0.1', 8000))
    token = uuid.uuid4().hex
    environment = {**os.environ, 'ONLYRAG_DATA_DIR': str(probe / 'frozen-state'), 'ONLYRAG_SIDECAR_TOKEN': token}
    executable = release / 'win-unpacked/resources/sidecar/sidecar.exe'
    log_path = probe / 'sidecar.log'
    with log_path.open('wb') as log:
        child = subprocess.Popen([str(executable)], cwd=executable.parent, env=environment,
                                 stdout=log, stderr=subprocess.STDOUT, creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            deadline = time.monotonic() + 30
            while True:
                if child.poll() is not None:
                    raise RuntimeError(f'Frozen Sidecar exited {child.returncode}; see {log_path}')
                try:
                    owner = json.loads(subprocess.check_output(['powershell', '-NoProfile', '-Command',
                        '(Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue).OwningProcess | ConvertTo-Json']).decode('utf-8') or 'null')
                    if owner is not None:
                        if owner != child.pid:
                            raise RuntimeError('Port 8000 is owned by another process; no request sent.')
                        with urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=5) as response:
                            health = json.load(response)
                        break
                except urllib.error.HTTPError:
                    raise
                except (urllib.error.URLError, TimeoutError):
                    pass
                if time.monotonic() > deadline:
                    raise RuntimeError('Frozen CPU Sidecar startup timed out.')
                time.sleep(0.25)
            if health['ocr']['provider'] != 'CPUExecutionProvider' or health['documents_count'] != 0:
                raise RuntimeError(f'Unexpected isolated frozen runtime: {health}')
            report['health'] = health
            payload = json.dumps({'markdown_content': 'ONLYRAG CPU 12345\n\n日本語', 'export_format': 'pdf'}).encode('utf-8')
            request = urllib.request.Request('http://127.0.0.1:8000/export', data=payload, headers={'Content-Type': 'application/json'})
            try:
                urllib.request.urlopen(request, timeout=5)
                raise RuntimeError('Protected export accepted an unauthenticated request.')
            except urllib.error.HTTPError as error:
                if error.code not in (401, 403):
                    raise
                report['unauthenticatedExportStatus'] = error.code
            request.add_header('X-OnlyRag-Token', token)
            with urllib.request.urlopen(request, timeout=20) as response:
                exported = json.load(response)
            pdf_path = Path(exported['file_path']).resolve()
            if not pdf_path.is_relative_to(probe / 'frozen-state'):
                raise RuntimeError('Export escaped the owned probe state.')
            with pymupdf.open(pdf_path) as document:
                text = '\n'.join(page.get_text() for page in document)
            report['pdfText'] = text
            report['pdfSha256'] = sha256(pdf_path)
            report['frozenSidecarSha256'] = sha256(executable)
            if 'ONLYRAG CPU 12345' not in text or '日本語' not in text:
                raise RuntimeError(f'Frozen Unicode PDF export failed: {text!r}')
        except Exception as error:
            report.update(status='failed', error=str(error))
            (probe / 'result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
            raise
        finally:
            if child.poll() is None:
                child.terminate()
                child.wait(timeout=10)
    report['status'] = 'passed'
    (probe / 'result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'PASS: real CPU OCR, owned frozen startup/auth and Unicode PDF export; evidence {probe}')


if __name__ == '__main__':
    main()
