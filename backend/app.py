# Entry point for Vercel's FastAPI runtime and `uvicorn app:app`.
from pos.main import create_app

app = create_app()
