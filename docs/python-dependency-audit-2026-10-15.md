# Python dependency advisory audit — 2026-10-15

## Scope and result

`pip-audit` 2.10.1 (PyPA), run through isolated `uvx` without `--fix`, returned exit code 0 for both PyPI and OSV on each input. The JSON results contain no vulnerability records or skipped packages:

| Input | PyPI | OSV | Evidence |
| --- | ---: | ---: | --- |
| `release/cpu-20261014-205040-fae7d51b/release-python-lock.txt` | 69 packages, 0 findings | 69 packages, 0 findings | [PyPI](./evidence/onlyrag-python-release-pypi-2026-10-15.json), [OSV](./evidence/onlyrag-python-release-osv-2026-10-15.json) |
| `.venv/Lib/site-packages` (development, including GPU requirements) | 81 packages, 0 findings | 81 packages, 0 findings | [PyPI](./evidence/onlyrag-python-dev-pypi-2026-10-15.json), [OSV](./evidence/onlyrag-python-dev-osv-2026-10-15.json) |

The release lock SHA-256 is `f0d54b26e0f23c01edc1e765ea71ff2f05202dd771ac243d0f882afae0a6b823`. Its 69 name/version pairs exactly match `licenses/component-manifest.json` in that candidate. The current CPU venv matches the lock except that `pip freeze` omits its installed `pip==26.2.1`. All 25 release and 26 development direct requirements match exact pins in the requirement files or `sidecar/constraints.txt`; both venvs pass `python -m pip check`. The release manifest records ONNX Runtime 1.29.0 with Azure and CPU providers. The retained PyInstaller folder has 18 `.dist-info` directories; auditing only those would miss packages represented in the build lock.

Commands used from the repository root (run once with `pypi` and once with `osv`, saving JSON with `--output`):

```powershell
uvx --from pip-audit==2.10.1 pip-audit -r .\release\cpu-20261014-205040-fae7d51b\release-python-lock.txt --no-deps --disable-pip --strict --vulnerability-service pypi --format json --progress-spinner off
uvx --from pip-audit==2.10.1 pip-audit --path .\.venv\Lib\site-packages --strict --vulnerability-service pypi --format json --progress-spinner off
```

## Runtime paths and disposition

No affected Python package version was reported, so there is no identified vulnerable Sidecar runtime path or compatible package remediation to apply in this snapshot. The audited dependency routes include HTTP/API (`sidecar/main.py`, FastAPI/Uvicorn/Pydantic), model/translation HTTP (`sidecar/config.py`, `sidecar/infrastructure/embeddings.py`, `sidecar/domain/translator.py`, `httpx`), storage (`sidecar/infrastructure/db.py`, LanceDB/Arrow), and document/OCR processing (`sidecar/domain/ingestion.py`, `sidecar/infrastructure/ocr.py`, PyMuPDF/RapidOCR/ONNX Runtime). PyInstaller is build-only in this set. If an advisory appears later, verify the affected call path and upstream fixed version against Python 3.13, the CPU/GPU split, Sidecar tests and packaged CPU probes before changing pins.

This is a dated known-advisory check, not proof of exploit absence or binary/native-library safety. The exact-version lock has no artifact hashes, so this scan does not verify package integrity. PyPA states that `pip-audit` checks known Python-package vulnerabilities and does not analyze code or embedded shared libraries. It does not replace independent installed-artifact or component-rights qualification. No project dependency or application package was changed. Sources: [PyPA usage and security model](https://github.com/pypa/pip-audit/blob/main/README.md#security-model), [PyPI release metadata](https://pypi.org/project/pip-audit/), [OSV API](https://osv.dev/docs/).
