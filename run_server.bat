@echo off
setlocal enabledelayedexpansion

set CMD=uvicorn server.main:app --reload --host 0.0.0.0 --port 8000
echo Starting Virtual Probability Simulation server...
echo Command: %CMD%
%CMD%
