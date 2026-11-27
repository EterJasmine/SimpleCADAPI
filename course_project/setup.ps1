$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if (!(Test-Path .venv/Scripts/python.exe)) {
    python -m venv .venv
    if ($LASTEXITCODE) { throw 'Python 3.10-3.13 is required.' }
}
& ./.venv/Scripts/python.exe -m pip install -r course_project/requirements.lock.txt
if ($LASTEXITCODE) { throw 'Dependency installation failed.' }
