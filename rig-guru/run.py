import subprocess
import os
import sys
import time
import webbrowser
import urllib.error
import urllib.request

# Paths
ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(ROOT_DIR, "backend")
FRONTEND_DIR = os.path.join(ROOT_DIR, "frontend")


def _npm_shell_prefix() -> str:
    """Windows PowerShell often blocks npm.ps1; npm.cmd avoids execution policy errors."""
    return "npm.cmd" if sys.platform == "win32" else "npm"


def _backend_port_preferred() -> int:
    """Preferred API port from backend/.env (same as main.py before auto-pick)."""
    try:
        from dotenv import load_dotenv

        load_dotenv(os.path.join(BACKEND_DIR, ".env"))
    except ImportError:
        pass
    return int(os.getenv("BACKEND_PORT", os.getenv("PORT", "8000")))


def _backend_listen_port() -> int:
    """First free port from preferred upward (avoids WinError 10048 if 8000 is taken)."""
    sys.path.insert(0, BACKEND_DIR)
    try:
        from rig_guru.server_port import find_listen_port

        return find_listen_port(_backend_port_preferred(), attempts=10)
    finally:
        try:
            sys.path.remove(BACKEND_DIR)
        except ValueError:
            pass


def _wait_for_url(
    url: str,
    process: subprocess.Popen,
    timeout: float = 25.0,
    status_every: float = 6.0,
) -> bool:
    """Return True if URL responds before timeout while the child process stays up."""
    start = time.time()
    deadline = start + timeout
    last_status = start
    while time.time() < deadline:
        if process.poll() is not None:
            return False
        try:
            urllib.request.urlopen(url, timeout=2)
            return True
        except (urllib.error.URLError, OSError):
            time.sleep(0.4)
            now = time.time()
            if now - last_status >= status_every:
                waited = int(now - start)
                print(
                    f"  ... still waiting for API ({waited}s / {int(timeout)}s max) — check backend window output",
                    flush=True,
                )
                last_status = now
    return False

def install_backend():
    print("\n[1/4] Installing Backend Dependencies...", flush=True)
    try:
        subprocess.check_call(
            [sys.executable, "-m", "pip", "install", "-r", "requirements.txt"],
            cwd=BACKEND_DIR,
        )
    except subprocess.CalledProcessError:
        print("Backend installation failed.")
        sys.exit(1)

def install_frontend():
    print("\n[2/4] Installing Frontend Dependencies (this may take a minute)...", flush=True)
    if not os.path.exists(os.path.join(FRONTEND_DIR, "node_modules")):
        try:
            npm = _npm_shell_prefix()
            subprocess.check_call(f"{npm} install", cwd=FRONTEND_DIR, shell=True)
        except subprocess.CalledProcessError:
            print("Frontend installation failed. Ensure npm is installed.")
            sys.exit(1)
    else:
        print("Frontend dependencies already present. Skipping install.", flush=True)

def start_app():
    preferred = _backend_port_preferred()
    port = _backend_listen_port()
    if port != preferred:
        print(
            f"\n[3/4] Starting Backend (port {port}, {preferred} was busy)...",
            flush=True,
        )
        print(
            f"  Set frontend/.env.local: BACKEND_INTERNAL_URL=http://127.0.0.1:{port}  then restart npm run dev.",
            flush=True,
        )
    else:
        print(f"\n[3/4] Starting Backend (port {port})...", flush=True)
    # -u: unbuffered prints so tracebacks show immediately in this console
    backend_process = subprocess.Popen(
        [sys.executable, "-u", "main.py"],
        cwd=BACKEND_DIR,
        env={**os.environ, "BACKEND_PORT": str(port), "PORT": str(port)},
    )

    time.sleep(1.5)
    if backend_process.poll() is not None:
        print(
            f"\n[ERROR] Backend quit right away (exit code {backend_process.returncode}).",
            flush=True,
        )
        print(
            f"  • Port {port} already in use? Close the other API terminal or set BACKEND_PORT=8001 in backend/.env",
            flush=True,
        )
        print("  • See the Python error above (scroll up).", flush=True)
        print("  • Manual test:  cd backend  then  python main.py", flush=True)
        sys.exit(1)

    docs_url = f"http://127.0.0.1:{port}/docs"
    print(
        f"\n  Waiting until the API answers at {docs_url} (up to ~30s)...",
        flush=True,
    )
    print("  (You should see Uvicorn lines above while the backend starts.)\n", flush=True)
    if not _wait_for_url(docs_url, backend_process, timeout=30.0):
        if backend_process.poll() is not None:
            print("\n[ERROR] Backend stopped during startup (see errors above).", flush=True)
        else:
            print(
                f"\n[WARNING] Backend process is running but {docs_url} did not respond in time.",
                flush=True,
            )
            print("  Check firewall or try:  cd backend && python main.py")
            backend_process.terminate()
        sys.exit(1)

    print("  Backend is up.", flush=True)
    print("\n[4/4] Starting Frontend (Port 3000)...", flush=True)
    npm = _npm_shell_prefix()
    frontend_process = subprocess.Popen(
        f"{npm} run dev",
        cwd=FRONTEND_DIR,
        shell=True,
    )

    time.sleep(2)
    if frontend_process.poll() is not None:
        print(
            f"\n[WARNING] Frontend process exited (code {frontend_process.returncode})."
        )
        print("  Is npm installed? Try:  cd frontend && npm run dev")
    else:
        print("  Frontend dev server starting (may take a few seconds).", flush=True)

    print("\n--- App is Running ---", flush=True)
    print(f"Backend:  http://localhost:{port}", flush=True)
    print("Frontend: http://localhost:3000", flush=True)
    print()
    print("This window will show logs and look 'idle' — that is normal.", flush=True)
    print("The servers are RUNNING. Open the URLs in your browser.", flush=True)
    print("Press Ctrl+C in THIS window when you want to stop everything.", flush=True)
    print()

    # Open browser after a short delay
    def open_browser():
        time.sleep(5)
        webbrowser.open("http://localhost:3000")
    
    import threading
    threading.Thread(target=open_browser, daemon=True).start()

    try:
        backend_process.wait()
        frontend_process.wait()
    except KeyboardInterrupt:
        print("\nStopping services...")
        backend_process.terminate()
        frontend_process.terminate()
        print("Done.")

if __name__ == "__main__":
    # Line-buffered / UTF-8 on Windows so you see output immediately in PowerShell/cmd
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(line_buffering=True, encoding="utf-8", errors="replace")
        except Exception:
            pass
    os.environ.setdefault("PYTHONUNBUFFERED", "1")

    print("--- Rig Guru — starting run.py ---", flush=True)
    print(f"Project folder: {ROOT_DIR}", flush=True)
    print("(Step 1 may take a while the first time while pip installs packages.)\n", flush=True)

    try:
        install_backend()
        install_frontend()
        start_app()
    except KeyboardInterrupt:
        print("\nStopped.", flush=True)
    except Exception as exc:
        print(f"\n[FATAL] run.py crashed: {exc}", flush=True)
        import traceback

        traceback.print_exc()
        sys.exit(1)
