import os, asyncio, io, wave
from datetime import datetime
from typing import Generator

import numpy as np
from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict
from sqlalchemy import create_engine, Column, Integer, String, Text, DateTime, desc
from sqlalchemy.orm import declarative_base, sessionmaker, Session
from faster_whisper import WhisperModel

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./speechflow.db")
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class Transcript(Base):
    __tablename__ = "transcripts"
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(200), nullable=False, default="Untitled transcription")
    text = Column(Text, nullable=False)
    language = Column(String(20), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

Base.metadata.create_all(bind=engine)

class TranscriptCreate(BaseModel):
    title: str = "Untitled transcription"
    text: str
    language: str | None = None

class TranscriptUpdate(BaseModel):
    title: str | None = None
    text: str | None = None
    language: str | None = None

class TranscriptOut(BaseModel):
    id: int
    title: str
    text: str
    language: str | None
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)

app = FastAPI(title="SpeechFlow API", version="1.0.0")
origins = os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

_model = None
_model_lock = asyncio.Lock()

def get_model():
    global _model
    if _model is None:
        
        _model = WhisperModel(os.getenv("WHISPER_MODEL", "small"), device="cpu", compute_type="int8")
    return _model

@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/api/transcripts", response_model=list[TranscriptOut])
def list_transcripts(q: str | None = None, db: Session = Depends(get_db)):
    query = db.query(Transcript)
    if q:
        query = query.filter(Transcript.title.ilike(f"%{q}%") | Transcript.text.ilike(f"%{q}%"))
    return query.order_by(desc(Transcript.created_at)).all()

@app.post("/api/transcripts", response_model=TranscriptOut, status_code=201)
def create_transcript(payload: TranscriptCreate, db: Session = Depends(get_db)):
    item = Transcript(title=payload.title.strip() or "Untitled transcription", text=payload.text.strip(), language=payload.language)
    if not item.text:
        raise HTTPException(400, "Transcription text cannot be empty")
    db.add(item); db.commit(); db.refresh(item)
    return item

@app.get("/api/transcripts/{transcript_id}", response_model=TranscriptOut)
def get_transcript(transcript_id: int, db: Session = Depends(get_db)):
    item = db.get(Transcript, transcript_id)
    if not item: raise HTTPException(404, "Transcription not found")
    return item

@app.put("/api/transcripts/{transcript_id}", response_model=TranscriptOut)
def update_transcript(transcript_id: int, payload: TranscriptUpdate, db: Session = Depends(get_db)):
    item = db.get(Transcript, transcript_id)
    if not item: raise HTTPException(404, "Transcription not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        if value is not None: setattr(item, key, value)
    item.updated_at = datetime.utcnow()
    db.commit(); db.refresh(item)
    return item

@app.delete("/api/transcripts/{transcript_id}")
def delete_transcript(transcript_id: int, db: Session = Depends(get_db)):
    item = db.get(Transcript, transcript_id)
    if not item: raise HTTPException(404, "Transcription not found")
    db.delete(item); db.commit()
    return {"deleted": True, "id": transcript_id}

@app.websocket("/ws/transcribe")
async def transcribe_socket(ws: WebSocket):
    await ws.accept()
    audio = np.empty(0, dtype=np.float32)
    last_processed = 0
    try:
        while True:
            message = await ws.receive()
            if message.get("text") == "STOP":
                await ws.send_json({"type": "stopped"})
                break
            data = message.get("bytes")
            if not data:
                continue
            
            chunk = np.frombuffer(data, dtype="<i2").astype(np.float32) / 32768.0
            audio = np.concatenate((audio, chunk))
            
            if len(audio) - last_processed >= 16000 * 3:
                last_processed = len(audio)
                try:
                    model = get_model()
                    segments, info = await asyncio.to_thread(
                        lambda: model.transcribe(audio.copy(), language=None, vad_filter=True, beam_size=1)
                    )
                    text = " ".join(seg.text.strip() for seg in segments).strip()
                    await ws.send_json({"type": "partial", "text": text, "language": info.language})
                except Exception as exc:
                    await ws.send_json({"type": "error", "message": str(exc)})
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        try: await ws.send_json({"type": "error", "message": str(exc)})
        except Exception: pass
