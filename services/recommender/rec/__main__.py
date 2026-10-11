"""python -m rec api | train | import-legacy"""
import sys

from .common import Config, connect, log, migrate


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "api"
    cfg = Config()
    cfg.check()
    if cmd == "api":
        import uvicorn
        from .api import create_app
        uvicorn.run(create_app(cfg), host="0.0.0.0", port=cfg.port, access_log=False, log_level="warning")
    elif cmd == "train":
        from . import train
        train.main(cfg)
    elif cmd == "import-legacy":
        from . import ingest
        with connect(cfg.database_url) as conn:
            migrate(conn)
        ingest.import_legacy(cfg)
    else:
        log("error", f"unknown command {cmd}: api | train | import-legacy")
        sys.exit(2)


main()
