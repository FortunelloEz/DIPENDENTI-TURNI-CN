# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path

block_cipher = None

root = Path(__file__).resolve().parents[1]
ui = root / "ui"
assets = root / "assets"
data = root / "data"

a = Analysis(
    ["app/main.py"],
    pathex=[str(root)],
    binaries=[],
    datas=[
        (str(ui), "ui"),
        (str(assets), "assets"),
    ],
    hiddenimports=["webview"],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="TurniCascina",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    icon=str(assets / "icon.ico") if (assets / "icon.ico").exists() else None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    name="TurniCascina",
)
