import sys
import io
import webview

# Forza UTF-8 su stdout e stderr (Windows usa cp1252 di default)
if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if sys.stderr and hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from cn_turni.api import Api
from cn_turni.db import init_db
from cn_turni.paths import paths


def main():
    index_path = str(paths.ui_index)

    # crea tabelle se non esistono
    init_db()

    # la pulizia delle settimane vecchie la fa Api() leggendo le Impostazioni
    api = Api()

    webview.create_window(
        title="Turni CN",
        url=index_path,
        js_api=api,
        maximized=True
    )

    webview.start()


if __name__ == "__main__":
    main()