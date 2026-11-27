param([string]$PythonCommand = 'python', [string]$VenvPath = '.venv', [switch]$MockOnly)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$venvPython = Join-Path $VenvPath 'Scripts/python.exe'
function Assert-Python313([string]$Executable) {
    & $Executable -c 'import sys; sys.exit(0 if sys.version_info[:2] == (3, 13) and sys.maxsize > 2**32 else 1)'
    if ($LASTEXITCODE) { throw 'Python 3.13 x64 is required. No packages were installed.' }
}
if (Test-Path $VenvPath) {
    if (!(Test-Path $venvPython)) { throw 'The existing environment is incomplete. Choose a new -VenvPath.' }
    Assert-Python313 $venvPython
} else {
    Assert-Python313 $PythonCommand
    & $PythonCommand -m venv $VenvPath
    if ($LASTEXITCODE) { throw 'Virtual environment creation failed.' }
    Assert-Python313 $venvPython
}
if ($MockOnly) {
    & $venvPython -m pip install -r course_project/requirements.mock.in -c course_project/requirements.lock.txt
} else {
    & $venvPython -m pip install -r course_project/requirements.lock.txt
}
if ($LASTEXITCODE) { throw 'Dependency installation failed.' }
& $venvPython -m pip check
if ($LASTEXITCODE) { throw 'Dependency compatibility check failed.' }
