param([ValidateSet('editor','api','test')][string]$Mode = 'editor',
      [string]$VenvPath = '.venv',
      [ValidateSet('mock','real')][string]$AiMode,
      [ValidateSet('mock','real')][string]$CadMode)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$python = Join-Path $VenvPath 'Scripts/python.exe'
if (!(Test-Path $python)) { throw 'Run course_project/setup.ps1 first.' }
if ($AiMode) { $env:AI_MODE = $AiMode }
if ($CadMode) { $env:CAD_MODE = $CadMode }
switch ($Mode) {
    'editor' { & (Join-Path $VenvPath 'Scripts/sca.exe') edit course_project/workspace --host 127.0.0.1 --port 7180 }
    'api' { & $python -m uvicorn course_project.backend:app --host 127.0.0.1 --port 8000 }
    'test' { & $python -m pytest course_project/tests -q }
}
exit $LASTEXITCODE
