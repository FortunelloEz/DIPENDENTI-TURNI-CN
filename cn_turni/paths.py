import sys
from pathlib import Path

class Paths:
    def __init__(self):
        self.root = self._resolve_root()

        # UI
        self.ui_dir = self.root / "ui"
        self.ui_index = self.ui_dir / "index.html"

        # Data dir: dev -> ./data, exe -> AppData/Roaming/TurniCascina
        self.data_dir = self._resolve_data_dir()
        self.data_dir.mkdir(parents=True, exist_ok=True)

        self.db_path = self.data_dir / "app.db"

        self.imports_dir = self.data_dir / "imports"
        self.exports_dir = self.data_dir / "exports"
        self.logs_dir = self.data_dir / "logs"

        for d in (self.imports_dir, self.exports_dir, self.logs_dir):
            d.mkdir(parents=True, exist_ok=True)

    def _resolve_root(self) -> Path:
        # app/paths.py -> app -> repo root
        return Path(__file__).resolve().parents[1]

    def _resolve_data_dir(self) -> Path:
        if getattr(sys, "frozen", False):
            # exe: %APPDATA%/TurniCascina
            return Path.home() / "AppData" / "Roaming" / "TurniCascina"
        return self.root / "data"
