# -*- mode: python ; coding: utf-8 -*-
import os

def _asset(name):
    for cand in (os.path.join('assets', name), os.path.join('..', 'server', 'assets', name), os.path.join('..', name)):
        if os.path.exists(cand):
            return cand
    return None

datas = []
if os.path.isdir('assets'):
    datas.append(('assets', 'assets'))
_icon = _asset('icon.ico')
if _icon:
    datas.append((_icon, '.'))

a = Analysis(
    ['hymnix_client_app.py'],
    pathex=['.'],
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
    name='Hymnix Client 1.2.0',
    debug=False, bootloader_ignore_signals=False, strip=False, upx=True,
    upx_exclude=[], runtime_tmpdir=None, console=False,
    disable_windowed_traceback=False, argv_emulation=False,
    target_arch=None, codesign_identity=None, entitlements_file=None,
    icon=[_icon] if _icon else None,
)
