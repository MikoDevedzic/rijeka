from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL environment variable not set")

# Sized for one uvicorn worker whose sync routes run in Starlette's threadpool
# (40 threads). Behind Supabase's transaction pooler (port 6543) each checkout
# holds a pooler client slot only for the duration of a transaction, so 25
# clients from this process is comfortably inside the pooler's limit.
engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=15,
    pool_timeout=30,
    pool_recycle=300,   # Supavisor drops idle clients; recycle before it does
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
