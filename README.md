# Real-time-Transcription

backend :
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

frontend:
npm install
npm run dev

AI model:

Whisper — small model
Inference library: faster-whisper
Self-hosted AI
An automatic speech recognition (ASR) model that converts audio into text and supports multiple languages.



Component       	    What it does
Whisper small	        Recognizes spoken words
faster-whisper	      Runs Whisper inference efficiently
FastAPI	              Receives audio and invokes the model
WebSocket	            Transfers audio chunks and transcription updates
React	                Displays the recognized text
PostgreSQL / SQLite	  Stores saved transcripts
