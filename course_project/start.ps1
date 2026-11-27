param([ValidateSet('editor','api','test')][string]$Mode = 'editor')
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$python = Join-Path (Get-Location) '.venv/Scripts/python.exe'
if (!(Test-Path $python)) { throw 'Run course_project/setup.ps1 first.' }
switch ($Mode) {
    'editor' { & ./.venv/Scripts/sca.exe edit course_project/workspace --host 127.0.0.1 --port 7180 }
    'api' { & $python -m uvicorn course_project.backend:app --host 127.0.0.1 --port 8000 }
    'test' { & $python -m pytest course_project/tests -q }
}
exit $LASTEXITCODE
