"""
Environment: resolve backend root and load ``backend/.env`` from any working directory.
"""
from pathlib import Path

from dotenv import load_dotenv


def backend_dir() -> Path:
    """Directory that contains ``.env``, ``requirements.txt``, and the ``rig_guru`` package."""
    return Path(__file__).resolve().parent.parent


def load_backend_dotenv() -> None:
    env_path = backend_dir() / ".env"
    if env_path.is_file():
        load_dotenv(env_path)
    else:
        load_dotenv()
