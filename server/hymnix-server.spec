# -*- mode: python ; coding: utf-8 -*-
import os

def _asset(name):
    for cand in (os.path.join('assets', name), name):
        if os.path.exists(cand):
            return cand
    return None

datas = []
for name in ('dashboard.html', 'icon.ico', 'icon.png', 'key1.wav', 'key2.wav', 'key3.wav', 'splash.png'):
    path = _asset(name)
    if path:
        datas.append((path, '.'))
if os.path.isdir('locales'):
    datas.append(('locales', 'locales'))
if os.path.isdir('assets'):
    datas.append(('assets', 'assets'))

_icon = _asset('icon.ico')
_splash = _asset('splash.png')

a = Analysis(
    ['hymnix_main.py'],
    pathex=['.'],
    binaries=[('cloudflared.exe', '.')] if os.path.exists('cloudflared.exe') else [],
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
    name='Hymnix 1.2.0',
    debug=False, bootloader_ignore_signals=False, strip=False, upx=True,
    upx_exclude=[], runtime_tmpdir=None, console=False,
    disable_windowed_traceback=False, argv_emulation=False,
    target_arch=None, codesign_identity=None, entitlements_file=None,
    icon=[_icon] if _icon else None,
    manifest='hymnix.manifest',
)
