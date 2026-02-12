import os
import webview

from cn_turni.api import Api
from cn_turni.db import init_db, apply_retention


def main():
    base_dir = os.path.dirname(os.path.abspath(__file__))

    # === UI path (NON TOCCATO) ===
    ui_dir = os.path.abspath(os.path.join(base_dir, "..", "ui"))
    index_path = os.path.join(ui_dir, "index.html")

    # === INIT DATABASE ===
    # crea tabelle se non esistono
    init_db()

    # retention settimane > 6 mesi
    apply_retention(months=6)

    api = Api()

    window = webview.create_window(
        title="Turni CN",
        url=index_path,
        js_api=api,
        maximized=True
    )

    webview.start()


if __name__ == "__main__":
    main()