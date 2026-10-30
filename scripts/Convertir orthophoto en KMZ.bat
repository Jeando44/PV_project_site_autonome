@echo off
setlocal
chcp 65001 >nul
rem Glisser-deposer une orthophoto (JPEG/PNG) sur ce fichier : produit un .kmz a ouvrir dans Google Earth Pro.
rem Le fichier de coordonnees (.jgw/.pgw/.tfw/.wld) doit se trouver a cote, avec le meme nom.
if "%~1"=="" (
  echo Faites glisser une image d orthophoto sur ce fichier, ou passez son chemin en argument.
  echo.
  pause
  exit /b 1
)
set "PY=%~dp0..\Skvenv313\Scripts\python.exe"
if not exist "%PY%" set "PY=python"
"%PY%" "%~dp0orthophoto_vers_kmz.py" %1 %2 %3
echo.
pause
