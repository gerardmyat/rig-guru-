import os

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from rig_guru import env

env.load_backend_dotenv()

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+psycopg2://postgres:postgres@localhost:5432/rigguru",
)

engine = create_engine(DATABASE_URL, pool_pre_ping=True, future=True)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def ensure_default_user_exists() -> None:
    """
    Optional dev user (userID=1). Disable with RIGGURU_SEED_DEFAULT_USER=0 when using auth only.
    """
    if os.getenv("RIGGURU_SEED_DEFAULT_USER", "1").lower() not in ("1", "true", "yes", "on"):
        return

    from rig_guru.models import Users
    from rig_guru.security import hash_password

    try:
        with SessionLocal() as session:
            if session.get(Users, 1) is None:
                session.add(
                    Users(
                        userID=1,
                        username="default_user",
                        email="default@rigguru.local",
                        password=hash_password("changeme"),
                        premiumStatus=False,
                    )
                )
                session.commit()
    except Exception:
        pass
