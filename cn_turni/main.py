import webview

from cn_turni.api import Api
from cn_turni.db import init_db, apply_retention
from cn_turni.paths import paths


def main():
    index_path = str(paths.ui_index)

    # crea tabelle se non esistono
    init_db()

    # retention settimane > 6 mesi
    apply_retention(months=6)

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