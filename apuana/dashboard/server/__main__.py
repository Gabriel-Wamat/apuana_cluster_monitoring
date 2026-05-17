import socket
import threading

from .config import PORT
from .http import Handler, _Server
from .slurm import _collect


def main() -> None:
    node = socket.gethostname()
    threading.Thread(target=_collect, daemon=True).start()
    print(f"[apuana] http://127.0.0.1:{PORT}")
    print(f"[apuana] ssh -N -L {PORT}:localhost:{PORT} <apuana-user>@{node}")
    _Server(("127.0.0.1", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
