@echo off
echo Updating ClinicalKB Study data...
echo.
"C:\Users\stace\AppData\Local\Programs\Python\Python39\python" "C:\Users\stace\spaceport\ClinicalKB-Study\build\export_kb.py"
echo.
echo Done! If you're using GitHub Pages, push the changes:
echo   cd C:\Users\stace\spaceport\ClinicalKB-Study
echo   git add -A
echo   git commit -m "Update study data"
echo   git push
echo.
pause
