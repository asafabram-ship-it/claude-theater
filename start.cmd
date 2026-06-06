@echo off
REM Launch Claude Theater. The app opens the browser itself once the
REM server is listening (no first-load race).
cd /d "%~dp0"
python -m claude_theater
