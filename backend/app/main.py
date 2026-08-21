from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import uploads

app = FastAPI()

origins = ["http://localhost:3000"] # Frontend location

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True, 
    allow_methods=["*"],
    allow_headers=["*"]
)

app.include_router(uploads.router)

@app.get("/")
def read_root():
    return {"status": "ok"}