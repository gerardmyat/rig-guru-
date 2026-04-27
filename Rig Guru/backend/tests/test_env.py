import os
from pathlib import Path
from rig_guru.env import backend_dir, load_backend_dotenv

def test_backend_dir():
    # The backend_dir should point to the 'backend' directory
    dir_path = backend_dir()
    assert isinstance(dir_path, Path)
    assert dir_path.name == "backend"

def test_load_backend_dotenv(monkeypatch, tmp_path):
    # Create a temporary backend directory structure
    fake_backend_dir = tmp_path / "backend"
    fake_backend_dir.mkdir()
    
    # Create a dummy .env file
    env_file = fake_backend_dir / ".env"
    env_file.write_text("TEST_VAR=hello_world\n")
    
    # Mock the backend_dir function to return our temporary directory
    monkeypatch.setattr("rig_guru.env.backend_dir", lambda: fake_backend_dir)
    
    # Run the function
    load_backend_dotenv()
    
    # Check if the environment variable was loaded
    assert os.getenv("TEST_VAR") == "hello_world"
