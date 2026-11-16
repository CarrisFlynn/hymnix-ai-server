# -*- mode: python ; coding: utf-8 -*-
import os
import struct

_SPEC_DIR = os.path.abspath(globals().get('SPECPATH') or os.path.dirname(globals().get('__file__', os.getcwd())))
_ROOT = os.path.abspath(os.path.join(_SPEC_DIR, '..'))
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
                 os.path.join(_SPEC_DIR, name),
                 os.path.join(_ROOT, 'assets', name)):
        if os.path.exists(cand):
            return cand
    return None

datas = [(_VERSION_PATH, '.')]
_java_jar = os.path.join(_ROOT, 'engine-java', 'build', 'hymnix-engine.jar')
if os.path.isfile(_java_jar):
    datas.append((_java_jar, os.path.join('engine-java', 'build')))
for name in ('dashboard.html', 'hymnix-red-white-star.ico', 'hymnix-red-white-star.png', 'icon.ico', 'icon.png', 'key1.wav', 'key2.wav', 'key3.wav', 'splash.png'):
    path = _asset(name)
    if path:
        datas.append((path, '.'))
if os.path.isdir(os.path.join(_SPEC_DIR, 'locales')):
    datas.append((os.path.join(_SPEC_DIR, 'locales'), 'locales'))
if os.path.isdir(os.path.join(_SPEC_DIR, 'assets')):
    datas.append((os.path.join(_SPEC_DIR, 'assets'), 'assets'))

_icon = _asset('hymnix-red-white-star.ico') or _asset('icon.ico')
if not _icon:
    raise SystemExit('server icon not found in ' + _SPEC_DIR)
# Headless backend: never attach a splash screen (no window may appear).
_splash = None

_cloudflared = os.path.join(_SPEC_DIR, 'cloudflared.exe')
if not os.path.exists(_cloudflared):
    _cloudflared = os.path.join(_ROOT, 'cloudflared.exe')

a = Analysis(
    [os.path.join(_SPEC_DIR, 'headless_gateway.py')],
    pathex=[_SPEC_DIR],
    binaries=[(_cloudflared, '.')] if os.path.exists(_cloudflared) else [],
    datas=datas,
    # Headless gateway only: no Tk UI modules are imported by this entry point.
    hiddenimports=['gateway_core', 'hxcore', 'hxcore.paths', 'hxcore.tokens', 'hxcore.logindex', 'hxcore.fstree', 'hxcore.tools', 'hxcore.approvals'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    # Hard guarantee: the shipped server payload must never contain Tk UI.
    excludes=[
        'tkinter', '_tkinter', 'ttk', 'tkinterdnd2',
        'hymnix_main', 'hymnix_main.py',
        'pages_modern', 'page_manager', 'pages_chat', 'pages_terminal',
        'pages_monitor', 'pages_plugins_live', 'pages_settings',
        'pages_history', 'pages_files', 'pages_diff', 'pages_approvals',
        'pages_usage', 'pages_ocr', 'pages_sessions', 'pages_git',
        'pages_cloud', 'ui_kit', 'update_ui', 'theme_dump',
    ],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)
splash = Splash(
    _splash,
    binaries=a.binaries,
    datas=a.datas,
    text_pos=None,
    text_size=12,
    minify_script=True,
    always_on_top=True,
) if _splash else None
_extra = [splash, splash.binaries] if splash else []
exe = EXE(
    pyz, a.scripts, a.binaries, a.datas, *_extra, [],
    name='hymnix-server-' + _VERSION + '-' + _ARCH,
    debug=False, bootloader_ignore_signals=False, strip=False, upx=True,
    upx_exclude=[], runtime_tmpdir=None, console=False,
    disable_windowed_traceback=False, argv_emulation=False,
    target_arch=None, codesign_identity=None, entitlements_file=None,
    icon=[_icon],
    manifest=os.path.join(_SPEC_DIR, 'hymnix.manifest'),
)


