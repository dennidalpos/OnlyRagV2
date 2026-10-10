"""Prepare and bind CPU release notices, source archives and artifact inventories."""

import argparse
import hashlib
import importlib.metadata as metadata
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import urllib.request
import zipfile


ROOT = Path(__file__).resolve().parent.parent
GPU_NAMES = ('cublas', 'cudnn', 'cufft', 'curand', 'cudart', 'nvrtc', 'nvjitlink',
             'onnxruntime_providers_cuda', 'onnxruntime_providers_tensorrt')
BUILD_TOOLS = {'pip', 'setuptools', 'pyinstaller', 'pyinstaller-hooks-contrib', 'altgraph', 'pefile', 'pywin32-ctypes'}


def sha256(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def write_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def is_gpu_library(path):
    parts = Path(path).as_posix().lower().replace('\\', '/').split('/')
    return 'nvidia' in parts or any(parts[-1].startswith(name) for name in GPU_NAMES)


def check_environment():
    names = {(d.metadata['Name'] or '').lower().replace('_', '-'): d.version for d in metadata.distributions()}
    forbidden = [name for name in names if name == 'onnxruntime-gpu' or name.startswith('nvidia-')]
    if forbidden or names.get('onnxruntime') != '1.29.0':
        raise RuntimeError(f'CPU release environment required; forbidden={forbidden}, CPU={names.get("onnxruntime")}')
    import onnxruntime
    providers = onnxruntime.get_available_providers()
    if 'CPUExecutionProvider' not in providers or any(p in providers for p in ('CUDAExecutionProvider', 'TensorrtExecutionProvider')):
        raise RuntimeError(f'Invalid CPU release providers: {providers}')
    return {'python': sys.version, 'onnxruntime': names['onnxruntime'], 'providers': providers, 'packages': names}


def fetch_json(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'OnlyRag-source-delivery'})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def download(url, target, expected_hash):
    if target.exists():
        if sha256(target) != expected_hash:
            raise RuntimeError(f'Changed retained source archive: {target}')
        return
    request = urllib.request.Request(url, headers={'User-Agent': 'OnlyRag-source-delivery'})
    with urllib.request.urlopen(request, timeout=45) as response, target.open('xb') as stream:
        shutil.copyfileobj(response, stream)
    if sha256(target) != expected_hash:
        raise RuntimeError(f'Upstream source hash mismatch: {target}')


def github_source(owner, repository, tag, directory):
    reference = fetch_json(f'https://api.github.com/repos/{owner}/{repository}/git/ref/tags/{tag}')['object']
    if reference['type'] == 'tag':
        reference = fetch_json(reference['url'])['object']
    if reference['type'] != 'commit':
        raise RuntimeError(f'Expected an immutable source commit: {repository} {tag}')
    revision = reference['sha']
    url = f'https://codeload.github.com/{owner}/{repository}/tar.gz/{revision}'
    cache = ROOT / 'build/release-cpu/source-cache'
    target = cache / f'{repository}-{tag}-{revision}.tar.gz'
    record_path = target.with_suffix(target.suffix + '.json')
    if target.exists() or record_path.exists():
        record = json.loads(record_path.read_text(encoding='utf-8'))
        if record['url'] != url or record['revision'] != revision or sha256(target) != record['sha256']:
            raise RuntimeError(f'Changed retained native source: {target}')
    else:
        request = urllib.request.Request(url, headers={'User-Agent': 'OnlyRag-source-delivery'})
        with urllib.request.urlopen(request, timeout=45) as response, target.open('xb') as stream:
            shutil.copyfileobj(response, stream)
        record = {'path': target.name, 'url': url, 'sha256': sha256(target), 'revision': revision,
                  'scope': 'Official repository archive; submodule/vendored completeness and exact native-wheel build correspondence require review.'}
        write_json(record_path, record)
    shutil.copyfile(target, directory / target.name)
    return record


def font_notices(licenses):
    script = r'''
    $ErrorActionPreference = 'Stop'
    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
    Add-Type -AssemblyName PresentationCore
    $records = @(Get-ChildItem -LiteralPath $env:ONLYRAG_BUILD_FONT_DIRECTORY -File | Where-Object { $_.Extension -in '.otf', '.ttf' } | ForEach-Object {
        $font = New-Object System.Windows.Media.GlyphTypeface -ArgumentList ([Uri]$_.FullName)
        [PSCustomObject]@{file=$_.Name; family=@($font.FamilyNames.Values); version=@($font.VersionStrings.Values); copyright=@($font.Copyrights.Values); license=@($font.LicenseDescriptions.Values)}
    })
    ConvertTo-Json -InputObject $records -Depth 4
    '''
    import os
    environment = {**os.environ, 'ONLYRAG_BUILD_FONT_DIRECTORY': str(ROOT / 'sidecar/assets/fonts')}
    records = json.loads(subprocess.check_output(['powershell', '-NoProfile', '-Command', script], env=environment).decode('utf-8-sig'))
    if len(records) != 5:
        raise RuntimeError(f'Expected five Noto fonts, found {len(records)}')
    lines = ['Noto font copyright and version notices', 'Metadata read from the exact shipped font bytes with Windows GlyphTypeface.', 'Full terms: OFL-NotoSans.txt and OFL-NotoSansCJK.txt.', '']
    for record in records:
        record['sha256'] = sha256(ROOT / 'sidecar/assets/fonts' / record['file'])
        if not record['copyright'] or not all('SIL Open Font License' in text for text in record['license']):
            raise RuntimeError(f'Incomplete font license metadata: {record["file"]}')
        lines.extend([record['file'], *record['version'], *record['copyright'], *record['license'], ''])
    write_json(licenses / 'font-manifest.json', records)
    (licenses / 'NOTO-FONTS.txt').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    return records


def native_notices(directory, sources, licenses):
    import pymupdf
    fallback_hash = hashlib.sha256(pymupdf.Font('cjk').buffer).hexdigest()
    fallback_matched = False
    records = []
    for source in sources:
        archive_path = directory / source['path']
        if sha256(archive_path) != source['sha256']:
            raise RuntimeError(f'Changed native source archive: {archive_path}')
        with tarfile.open(archive_path) as archive:
            for member in archive:
                if not member.isfile():
                    continue
                parts = Path(member.name).parts
                if Path(member.name).is_absolute() or '..' in parts or len(parts) < 2:
                    raise RuntimeError(f'Unsafe native source member: {member.name}')
                relative = Path(*parts[1:])
                if relative.as_posix() == 'resources/fonts/droid/DroidSansFallback.ttf':
                    with archive.extractfile(member) as stream:
                        if hashlib.file_digest(stream, 'sha256').hexdigest() != fallback_hash:
                            raise RuntimeError('MuPDF source font differs from the runtime fallback.')
                    fallback_matched = True
                if not relative.name.lower().startswith(('license', 'notice', 'copying', 'copyright')):
                    continue
                target = licenses / 'native' / parts[0] / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.extractfile(member) as stream, target.open('xb') as output:
                    shutil.copyfileobj(stream, output)
                records.append({'path': target.relative_to(licenses).as_posix(), 'sha256': sha256(target),
                                'sourceArchiveSha256': source['sha256']})
    if not fallback_matched:
        raise RuntimeError('Runtime Droid fallback font has no matching retained source.')
    return {'notices': records, 'runtimeDroidFallbackSha256': fallback_hash,
            'scope': 'Pinned native repository notice superset; submodules and final component coverage still require review.'}


def copy_notice(source, destination, entries, owner):
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination)
    entries.append({'owner': owner, 'path': destination.name,
                    'sha256': sha256(destination)})


def prepare(release):
    environment = check_environment()
    licenses = release / 'licenses'
    licenses.mkdir(exist_ok=False)
    source_dir = release / 'dependency-sources'
    source_dir.mkdir(exist_ok=False)
    packet = ROOT / 'docs/licenses/agpl-route-2026-10-10'
    notices = []
    for filename in ('AGPL-3.0.txt', 'Apache-2.0.txt', 'CC-BY-SA-4.0.txt', 'wordfreq-3.1.1-code-license.txt',
                     'wordfreq-3.1.1-data-attribution.txt', 'OFL-NotoSans.txt', 'OFL-NotoSansCJK.txt'):
        copy_notice(packet / filename, licenses / filename, notices, 'prepared terms/attribution')
    for filename in ('LICENSE', 'DISTRIBUTION-LICENSE.md'):
        copy_notice(ROOT / filename, licenses / filename, notices, 'OnlyRag')
    fonts = font_notices(licenses)
    copy_notice(Path(sys.base_prefix) / 'LICENSE.txt', licenses / 'Python-LICENSE.txt', notices, 'CPython runtime')
    freeze = subprocess.check_output([sys.executable, '-m', 'pip', 'freeze', '--all']).decode('utf-8')
    (release / 'release-python-lock.txt').write_text(freeze, encoding='utf-8')

    distributions = []
    residuals = []
    cache = ROOT / 'build/release-cpu/source-cache'
    cache.mkdir(parents=True, exist_ok=True)
    for dist in sorted(metadata.distributions(), key=lambda d: d.metadata['Name'].lower()):
        name = dist.metadata['Name']
        normalized = name.lower().replace('_', '-')
        files = []
        for entry in dist.files or []:
            source = Path(dist.locate_file(entry))
            if not source.is_file() or not any(token in source.name.lower() for token in ('license', 'copying', 'notice', 'copyright')):
                continue
            if source.suffix.lower() in ('.py', '.pyc', '.pyd', '.dll'):
                continue
            target = licenses / 'python' / name / entry.as_posix()
            if '..' in Path(entry).parts:
                raise RuntimeError(f'Out-of-package notice: {entry}')
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
            files.append({'path': target.relative_to(licenses).as_posix(), 'sha256': sha256(target)})
        record = {'name': name, 'version': dist.version, 'declaredLicense': dist.metadata.get('License-Expression') or dist.metadata.get('License'), 'notices': files}
        if normalized not in BUILD_TOOLS:
            url = f'https://pypi.org/pypi/{name}/{dist.version}/json'
            data = fetch_json(url)
            archives = [entry for entry in data['urls'] if entry['packagetype'] == 'sdist']
            if archives:
                archive = archives[0]
                target = cache / archive['filename']
                download(archive['url'], target, archive['digests']['sha256'])
                shutil.copyfile(target, source_dir / target.name)
                record['source'] = {'path': target.name, 'url': archive['url'], 'sha256': archive['digests']['sha256'], 'kind': 'upstream-sdist'}
            else:
                # Preserve installed source and assets; native wheel build correspondence stays explicit.
                target = source_dir / f'{name}-{dist.version}-installed-source.zip'
                with zipfile.ZipFile(target, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
                    for entry in dist.files or []:
                        installed = Path(dist.locate_file(entry))
                        if installed.suffix.lower() not in ('.pyc', '.pyd', '.dll', '.so') and installed.is_file() and '..' not in Path(entry).parts:
                            archive.write(installed, entry.as_posix())
                record['source'] = {'path': target.name, 'sha256': sha256(target), 'kind': 'installed-source-and-assets'}
                residuals.append(f'{name} {dist.version}: installed source/assets captured without a PyPI sdist; review upstream provenance and any native build correspondence.')
        distributions.append(record)
        print(f'Source/notice captured: {name} {dist.version}', flush=True)

    node_records = []
    for package_path in sorted((ROOT / 'node_modules').rglob('package.json')):
        if package_path.parent.parent.name != 'node_modules' and package_path.parent.parent.parent.name != 'node_modules':
            continue
        package = json.loads(package_path.read_text(encoding='utf-8'))
        if not package.get('name') or not package.get('version'):
            continue
        files = []
        for source in package_path.parent.iterdir():
            if source.is_file() and any(source.name.lower().startswith(token) for token in ('license', 'licence', 'copying', 'notice', 'copyright')):
                target = licenses / 'node' / source.relative_to(ROOT / 'node_modules')
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, target)
                files.append({'path': target.relative_to(licenses).as_posix(), 'sha256': sha256(target)})
        node_records.append({'name': package['name'], 'version': package['version'], 'declaredLicense': package.get('license'), 'notices': files})
    for filename in ('LICENSE', 'LICENSES.chromium.html'):
        source = ROOT / 'node_modules/electron/dist' / filename
        if not source.is_file():
            raise RuntimeError(f'Missing Electron notice: {source}')
        shutil.copyfile(source, licenses / f'Electron-{filename}')

    import pymupdf
    native_sources = [github_source('microsoft', 'onnxruntime', 'v1.29.0', source_dir),
                      github_source('ArtifexSoftware', 'mupdf', pymupdf.VersionFitz, source_dir),
                      github_source('lancedb', 'lancedb', 'v0.37.1', source_dir)]
    native_notice_records = native_notices(source_dir, native_sources, licenses)
    residuals.extend([
        f'Bind complete native MuPDF {pymupdf.VersionFitz} sources/build settings used by PyMuPDF {pymupdf.VersionBind}.',
        'Verify native/transitive source completeness (including vendored code and native wheel build settings); sdists alone are not certification.',
        'Review upstream font provenance and complete RapidOCR/model/sample-network attribution; exact binary font copyright/version notices are included.',
        'Review actual bundled Renderer/Main/native inventory against the installed-build-environment notice superset.',
        'Public equivalent-access source delivery remains pending; no publication is authorized.'
    ])
    manifest = {'schemaVersion': 1, 'kind': 'local-cpu-release-candidate', 'distributionLicense': 'GNU AGPL v3',
                'environment': environment, 'python': distributions, 'nodeBuildEnvironment': node_records,
                'preparedTexts': notices, 'fonts': fonts, 'nativeSourceArchives': native_sources,
                'nativeNotices': native_notice_records, 'qualificationResiduals': residuals}
    write_json(licenses / 'component-manifest.json', manifest)
    shutil.copyfile(packet / 'NOTICE-DRAFT.md', licenses / 'review-notice-draft.md')
    (licenses / 'NOTICE.txt').write_text(
        'OnlyRag CPU distribution candidate\nCopyright (c) 2026 Danny Perondi\nGNU AGPL version 3; no warranty. Redistribution and modification are permitted under its full terms.\n'
        'Original project code retains MIT permissions. Component grants/copyrights remain in the accompanying files.\n'
        'See DISTRIBUTION-LICENSE.md, AGPL-3.0.txt, wordfreq attribution, review-notice-draft.md, python/ and node/.\n'
        'component-manifest.json records the installed build environment and unresolved source/notice qualification.\n', encoding='utf-8')
    package = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))
    config = package['build']
    config['directories']['output'] = str(release)
    config['extraMetadata'] = {'license': 'AGPL-3.0'}
    config['extraResources'] = [
        {'from': str(release / 'sidecar-dist/sidecar'), 'to': 'sidecar', 'filter': ['**/*']},
        {'from': str(licenses), 'to': 'licenses', 'filter': ['**/*']},
    ]
    config['nsis']['license'] = str(licenses / 'AGPL-3.0.txt')
    write_json(release / 'electron-builder.json', config)
    archive_sources(release)


def archive_sources(release):
    licenses = release / 'licenses'
    version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
    source_zip = release / f'OnlyRag-{version}-source.zip'
    paths = subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], cwd=ROOT).decode('utf-8').split('\0')
    source_records = []
    with zipfile.ZipFile(source_zip, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
        for name in sorted(set(filter(None, paths))):
            source = ROOT / name
            if source.is_symlink() or not source.is_file() or not source.resolve().is_relative_to(ROOT):
                raise RuntimeError(f'Unsafe or missing source file: {name}')
            archive.write(source, f'OnlyRag/{name}')
            source_records.append({'path': name, 'sha256': sha256(source)})
        for source in (release / 'dependency-sources').iterdir():
            archive.write(source, f'dependency-sources/{source.name}')
        for source in sorted((ROOT / 'node_modules').rglob('*')):
            if source.is_file() and not source.is_symlink() and source.suffix.lower() in ('.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.json', '.map', '.css', '.md', '.txt', '.html', '.c', '.cpp', '.h', '.hpp'):
                archive.write(source, f'node-package-sources/{source.relative_to(ROOT / "node_modules").as_posix()}')
        archive.write(licenses / 'component-manifest.json', 'component-manifest.json')
        archive.write(release / 'release-python-lock.txt', 'release-python-lock.txt')
        archive.writestr('BUILD.txt', 'Project: OnlyRag/\nWindows x64, Node 24/npm 11, Python 3.13.\nRun npm ci and node node_modules/electron/install.js in OnlyRag/.\nCreate build/release-cpu/venv with Python 3.13 and install the adjacent release-python-lock.txt into it, then run npm run package:win.\nCPU release requirements: sidecar/requirements-release.txt.\nReview component-manifest.json residuals before claiming corresponding-source completeness or publishing.\n')
    source_hash = sha256(source_zip)
    delivery = f'Matching source candidate: {source_zip.name}\nSHA-256: {source_hash}\nOffer this archive next to the matching installer with equivalent access at no additional charge, under AGPL section 6(d).\nThis local build has not been published; component-manifest.json records remaining source/notice qualification.\n'
    (licenses / 'SOURCE-DELIVERY.txt').write_text(delivery, encoding='utf-8')
    write_json(release / 'project-source-manifest.json', source_records)
    write_json(release / 'source-delivery.json', {'path': source_zip.name, 'sha256': source_hash})


def finalize(release):
    licenses = release / 'licenses'
    source_record = json.loads((release / 'source-delivery.json').read_text(encoding='utf-8'))
    source_zip = release / source_record['path']
    source_hash = sha256(source_zip)
    if source_hash != source_record['sha256']:
        raise RuntimeError('Changed source archive')
    installed = release / 'win-unpacked/resources/licenses'
    for source in licenses.rglob('*'):
        if source.is_file() and sha256(source) != sha256(installed / source.relative_to(licenses)):
            raise RuntimeError(f'Missing or changed installed notice: {source}')
    binaries = []
    for source in (release / 'win-unpacked').rglob('*'):
        if not source.is_file():
            continue
        if is_gpu_library(source):
            raise RuntimeError(f'GPU library leaked into CPU release: {source}')
        binaries.append({'path': source.relative_to(release).as_posix(), 'bytes': source.stat().st_size, 'sha256': sha256(source)})
    installers = list(release.glob('*Setup*.exe'))
    if len(installers) != 1:
        raise RuntimeError(f'Expected one installer, found {len(installers)}')
    manifest = {'schemaVersion': 1, 'kind': 'local-cpu-release-candidate', 'source': {'path': source_zip.name, 'sha256': source_hash},
                'installer': {'path': installers[0].name, 'sha256': sha256(installers[0]), 'bytes': installers[0].stat().st_size},
                'files': binaries, 'publicDistributionQualified': False,
                'qualificationResiduals': json.loads((licenses / 'component-manifest.json').read_text(encoding='utf-8'))['qualificationResiduals']}
    write_json(release / 'release-manifest.json', manifest)
    print(f'CPU artifact/source candidate captured: {len(binaries)} installed files; public distribution remains unqualified.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('environment', 'prepare', 'finalize'))
    parser.add_argument('--release-root', type=Path)
    args = parser.parse_args()
    if args.command == 'environment':
        print(json.dumps(check_environment()))
        return
    release = args.release_root.resolve() if args.release_root else None
    if release is None or not release.is_relative_to(ROOT / 'release') or release == ROOT / 'release':
        parser.error('An explicit child of the repository release directory is required.')
    if not release.is_dir() or release.is_symlink():
        parser.error('Release root must be an existing plain directory.')
    {'prepare': prepare, 'finalize': finalize}[args.command](release)


if __name__ == '__main__':
    main()
