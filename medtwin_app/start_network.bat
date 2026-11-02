@echo off
rem Start MedTwin for doctors on the hospital network (HTTPS on port 8443, doctor logins required).
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  echo Run start.bat once first to create the environment.
  pause
  exit /b 1
)
.venv\Scripts\python scripts\network_setup.py || (pause & exit /b 1)
start "" https://127.0.0.1:8443
.venv\Scripts\python -m uvicorn server.app:app --host 0.0.0.0 --port 8443 --ssl-keyfile certs\medtwin.key --ssl-certfile certs\medtwin.crt
pause
