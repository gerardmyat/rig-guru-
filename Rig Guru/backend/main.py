"""
Run the API server from the ``backend`` directory (used by ``run.py``).

Port: prefers ``BACKEND_PORT`` / ``PORT`` / **8000**. If that port is busy (Windows **10048**),
the next free port up to +9 is used automatically. Sync the frontend proxy if not 8000:
``BACKEND_INTERNAL_URL=http://127.0.0.1:<port>`` in ``frontend/.env.local``.
"""
import os
import sys

from rig_guru.api.app import app

if __name__ == "__main__":
    import uvicorn

    from rig_guru.server_port import find_listen_port

    preferred = int(os.getenv("BACKEND_PORT", os.getenv("PORT", "8000")))

    print("\n=== Rig Guru API ===", flush=True)
    try:
        port = find_listen_port(preferred, attempts=10)
    except RuntimeError as exc:
        print(f"[ERROR] {exc}", flush=True)
        sys.exit(1)

    if port != preferred:
        print(
            f"Port {preferred} is already in use — using {port} instead (WinError 10048 / address in use).",
            flush=True,
        )
        print(
            f"  → Add to frontend/.env.local:  BACKEND_INTERNAL_URL=http://127.0.0.1:{port}",
            flush=True,
        )
        print("  → Then restart:  npm run dev\n", flush=True)

    print(f"Listening: http://localhost:{port}  (docs: /docs)", flush=True)
    print("Press Ctrl+C to stop.\n", flush=True)

    uvicorn.run(app, host="0.0.0.0", port=port)
