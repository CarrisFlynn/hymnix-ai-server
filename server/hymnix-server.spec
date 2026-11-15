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
                 os.path.join(_SPEC_DIR, name),
                 os.path.join(_ROOT, 'assets', name)):
        if os.path.exists(cand):
            return cand
    return None

datas = [(_VERSION_PATH, '.')]
for name in ('dashboard.html', 'icon.ico', 'icon.png', 'key1.wav', 'key2.wav', 'key3.wav', 'splash.png'):
    path = _asset(name)
    if path:
        datas.append((path, '.'))
if os.path.isdir(os.path.join(_SPEC_DIR, 'locales')):
    datas.append((os.path.join(_SPEC_DIR, 'locales'), 'locales'))
if os.path.isdir(os.path.join(_SPEC_DIR, 'assets')):
    datas.append((os.path.join(_SPEC_DIR, 'assets'), 'assets'))

_icon = _asset('icon.ico')
if not _icon:
    raise SystemExit('icon.ico not found: expected assets/icon.ico in ' + _SPEC_DIR)
_splash = _asset('splash.png')

_cloudflared = os.path.join(_SPEC_DIR, 'cloudflared.exe')
if not os.path.exists(_cloudflared):
    _cloudflared = os.path.join(_ROOT, 'cloudflared.exe')

a = Analysis(
    [os.path.join(_SPEC_DIR, 'hymnix_main.py')],
    pathex=[_SPEC_DIR],
    binaries=[(_cloudflared, '.')] if os.path.exists(_cloudflared) else [],
    datas=datas,
    hiddenimports=['gateway_core', 'usage', 'providers', 'i18n', 'pages_modern', 'ui_kit', 'page_manager', 'hxcore.timing', 'hxcore.logindex', 'hxcore.crash', 'hxcore.plugins', 'hxcore.tools', 'hxcore.toolcall', 'pages_tools_live', 'pages_plugins_live', 'hxcore.mcp', 'hxcore.history', 'pages_crash_live', 'pages_history_live', 'hxcore.ocr', 'hxcore.fstree', 'hxcore.diffx', 'pages_files_live', 'pages_diff_live', 'hxcore.approvals', 'hxcore.tokens', 'pages_approvals_live', 'pages_usage_live', 'pages_ocr_live', 'hxcore.compress', 'hxcore.sessions', 'hxcore.gitproxy', 'pages_sessions_live', 'pages_git_live', 'hxcore.cloudhub', 'hxcore.plugin_index', 'hxcore.gwbench', 'pages_cloudhub_live', 'hxcore', 'hxcore.chat_bubble', 'hxcore.paths', 'hxcore.md_render', 'hxcore.term_theme', 'hxcore.bubble', 'pages_approval_dialog', 'pages_terminal_live'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
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
