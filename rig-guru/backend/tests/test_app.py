from fastapi.testclient import TestClient
from rig_guru.api.app import app

client = TestClient(app)

def test_health_endpoint():
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert "ok" in data
