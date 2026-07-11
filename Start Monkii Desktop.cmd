@echo off
title Monkii Desktop
cd /d "%~dp0"

rem Ollama models location: uses your OLLAMA_MODELS env var if set, otherwise
rem the app asks on first launch (or falls back to Ollama's default).

rem first run: install dependencies (Electron included)
if not exist "node_modules\electron" (
    echo Installing dependencies, this may take a minute...
    call npm install
)

rem launch the native desktop app (starts Ollama + server automatically)
".\node_modules\.bin\electron.cmd" .
