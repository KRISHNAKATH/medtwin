@echo off
rem Start the MedTwin web app on http://127.0.0.1:8000 (creates the virtual environment on first run).
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  echo Creating virtual environment...
  py -3.11 -m venv --system-site-packages .venv || python -m venv --system-site-packages .venv
  .venv\Scripts\python -m pip install -r requirements.txt
)
start "" http://127.0.0.1:8000
.venv\Scripts\python -m uvicorn server.app:app --host 127.0.0.1 --port 8000
