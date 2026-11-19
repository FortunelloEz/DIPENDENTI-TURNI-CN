# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['cn_turni\\main.py'],
    pathex=[],
    binaries=[],
    # Solo la UI: l'exe usa %APPDATA%\TurniCascina per i dati (vedi cn_turni/paths.py).
    # NON includere 'data': conterrebbe il DB reale e i CSV con nomi ed email dei dipendenti.
    datas=[('ui', 'ui')],
    hiddenimports=['webview', 'webview.platforms.edge'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='TurniCN',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=['icona.ico'],
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='TurniCN',
)
