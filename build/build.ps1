$ErrorActionPreference = "Stop"

if (-not (Test-Path ".\.venv")) {
  python -m venv .venv
}

.\.venv\Scripts\activate
pip install -r requirements.txt

pyinstaller build\turni.spec --noconfirm
Write-Host "Build completata: dist\TurniCascina\TurniCascina.exe"
