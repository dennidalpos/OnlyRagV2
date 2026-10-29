# -*- mode: python ; coding: utf-8 -*-
import os
import sys
from PyInstaller.utils.hooks import collect_all, collect_data_files, collect_dynamic_libs

sys.path.insert(0, SPECPATH)
from scripts.release_artifacts import check_environment, is_gpu_library

check_environment()

datas = [
    # translator.py locates these via a __file__-relative path (sidecar/assets/fonts); PyInstaller
    # preserves that relative layout under _internal/ for bundled data files, but only if listed
    # here -- it does not pick up arbitrary non-Python files from the source tree on its own.
    (os.path.join(SPECPATH, 'sidecar', 'assets', 'fonts'), os.path.join('sidecar', 'assets', 'fonts')),
    (os.path.join(SPECPATH, 'sidecar', 'assets', 'vocab'), os.path.join('sidecar', 'assets', 'vocab')),
]
binaries = []
hiddenimports = ['pyarrow.parquet']

for pkg in ['lancedb', 'pymupdf', 'fastapi', 'uvicorn', 'pydantic', 'docx', 'rapidocr', 'wordfreq', 'langdetect', 'ftfy', 'puremagic', 'tabulate', 'chevron', 'openpyxl', 'xlrd']:
    try:
        tmp_ret = collect_all(pkg)
        datas += tmp_ret[0]
        binaries += tmp_ret[1]
        hiddenimports += tmp_ret[2]
    except Exception as exc:
        raise RuntimeError(f"Failed to collect PyInstaller assets for {pkg}") from exc

# Collect CPU runtime assets without importing optional quantization tools.
datas += collect_data_files('onnxruntime')
binaries += collect_dynamic_libs('onnxruntime')

sidecar_script = os.path.abspath(os.path.join(SPECPATH, 'sidecar', 'main.py'))

a = Analysis(
    [sidecar_script],
    # SPECPATH (the directory containing this .spec, i.e. the project root) must be on pathex so
    # PyInstaller can resolve the `sidecar` package for import at runtime -- it has no __init__.py
    # (an implicit PEP 420 namespace package), and without this it fails at startup with
    # "ModuleNotFoundError: No module named 'sidecar'" despite building without error (verified
    # empirically: the compiled exe crashed on launch until this was added).
    pathex=[SPECPATH],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
for name, source, _kind in a.binaries:
    if is_gpu_library(name) or is_gpu_library(source):
        raise RuntimeError(f"GPU library cannot enter the CPU release: {name}")

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='sidecar',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='sidecar',
)
