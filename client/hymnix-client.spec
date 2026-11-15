# -*- mode: python ; coding: utf-8 -*-
import os
import struct

_SPEC_DIR = os.path.abspath(globals().get('SPECPATH') or os.path.dirname(globals().get('__file__', os.getcwd())))
_ROOT = os.path.abspath(os.path.join(_SPEC_DIR, '..', '..'))
_VERSION_PATH = os.path.join(_ROOT, 'VERSION')
with open(_VERSION_PATH, 'r', encoding='utf-8') as _version_file:
    _VERSION = _version_file.read().strip()
if not _VERSION:
    raise SystemExit('VERSION is empty: ' + _VERSION_PATH)
if struct.calcsize('P') * 8 != 64:
    raise SystemExit('x64 PyInstaller build requires 64-bit Python')
_ARCH = 'x64'

def _asset(name):
    for cand in (os.path.join(_SPEC_DIR, 'assets', name),
                 os.path.join(_SPEC_DIR, '..', 'server', 'assets', name),
                 os.path.join(_ROOT, 'assets', name),
                 os.path.join(_SPEC_DIR, name)):
        if os.path.exists(cand):
            return cand
    return None

datas = [(_VERSION_PATH, '.')]
if os.path.isdir(os.path.join(_SPEC_DIR, 'assets')):
    datas.append((os.path.join(_SPEC_DIR, 'assets'), 'assets'))
_icon = _asset('icon.ico')
if not _icon:
    raise SystemExit('icon.ico not found: expected assets/icon.ico in ' + _SPEC_DIR)
datas.append((_icon, '.'))

a = Analysis(
    [os.path.join(_SPEC_DIR, 'hymnix_client_app.py')],
    pathex=[_SPEC_DIR],
    binaries=[],
    datas=datas,
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz, a.scripts, a.binaries, a.datas, [],
    name='hymnix-client-' + _VERSION + '-' + _ARCH,
    debug=False, bootloader_ignore_signals=False, strip=False, upx=True,
    upx_exclude=[], runtime_tmpdir=None, console=False,
    disable_windowed_traceback=False, argv_emulation=False,
    target_arch=None, codesign_identity=None, entitlements_file=None,
    icon=[_icon],
)
