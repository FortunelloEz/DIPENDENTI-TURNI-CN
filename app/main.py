import webview

from app.api import Api
from app.paths import Paths
from app.utils.logging import setup_logging

def main():
    paths = Paths()
    setup_logging(paths.logs_dir)

    # inizializza DB (crea file + tabelle se mancano)
    from app.db.schema import init_db
    init_db(paths.db_path)

    api = Api(paths)

    window = webview.create_window(
        title="Turni Cascina",
        url=str(paths.ui_index),
        js_api=api,
        width=1280,
        height=800,
        resizable=True,
    )
    webview.start(debug=False)

if __name__ == "__main__":
    main()
