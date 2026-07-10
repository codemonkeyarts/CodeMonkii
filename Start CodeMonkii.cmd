@echo off
title CodeMonkii
cd /d "%~dp0"

rem Ollama models location: set the OLLAMA_MODELS env var (system-wide or
rem right here) if your models live somewhere other than Ollama's default:
rem     set OLLAMA_MODELS=D:\path\to\models

rem start Ollama if it isn't already running
tasklist /FI "IMAGENAME eq ollama.exe" 2>nul | find /I "ollama.exe" >nul
if errorlevel 1 (
    echo Starting Ollama...
    start "" /min ollama serve
    timeout /t 3 /nobreak >nul
)

echo Starting CodeMonkii at http://localhost:8113 ...
start "" http://localhost:8113
node server.js
