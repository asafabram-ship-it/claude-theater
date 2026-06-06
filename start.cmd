@echo off
REM Launch Agent Theater and open it in the browser.
cd /d "%~dp0"
start "" http://localhost:7333
python theater.py
