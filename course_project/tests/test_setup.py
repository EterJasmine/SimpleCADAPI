"""Exercise install guards without installing packages or altering an existing env."""
from pathlib import Path
import shutil
import subprocess
import sys
import pytest
from course_project.config import ROOT

POWERSHELL = shutil.which("pwsh") or shutil.which("powershell")
pytestmark = pytest.mark.skipif(sys.platform != "win32" or not POWERSHELL, reason="Windows setup guards")


def test_incomplete_environment_is_preserved(tmp_path):
    marker = tmp_path / "keep.txt"
    marker.write_text("keep")
    result = subprocess.run([POWERSHELL, "-NoProfile", "-File", str(ROOT / "setup.ps1"),
                             "-VenvPath", str(tmp_path)], capture_output=True, text=True, encoding="utf-8", errors="replace")
    assert result.returncode != 0
    assert "incomplete" in result.stderr
    assert marker.read_text() == "keep"


def test_failed_version_check_stops_before_creation(tmp_path):
    # Simulate an interpreter which rejects the version/architecture check.
    interpreter = tmp_path / "wrong-python.cmd"
    interpreter.write_text("@exit /b 1\n")
    target = tmp_path / "must-not-create"
    result = subprocess.run([POWERSHELL, "-NoProfile", "-File", str(ROOT / "setup.ps1"),
                             "-PythonCommand", str(interpreter), "-VenvPath", str(target)],
                            capture_output=True, text=True, encoding="utf-8", errors="replace")
    assert result.returncode != 0
    assert "Python 3.13 x64 is required" in result.stderr
    assert not target.exists()
