"""Pick a TCP port the API can bind to (handles WinError 10048 / EADDRINUSE)."""
from __future__ import annotations

import socket
from typing import Optional


def find_listen_port(start: int, attempts: int = 10) -> int:
    """
    Return the first port in [start, start + attempts) that accepts bind on 0.0.0.0.
    Raises RuntimeError if none are free.
    """
    last_err: Optional[OSError] = None
    for port in range(start, start + attempts):
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind(("0.0.0.0", port))
        except OSError as exc:
            last_err = exc
            continue
        finally:
            sock.close()
        return port
    hint = f" (last error: {last_err})" if last_err else ""
    raise RuntimeError(
        f"No free port in range {start}–{start + attempts - 1}.{hint} "
        "Close the other process using that port or set BACKEND_PORT to a free port in backend/.env."
    )
