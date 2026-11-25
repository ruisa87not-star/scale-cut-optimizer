@echo off
setlocal

set "VSDEVCMD=%ProgramFiles(x86)%\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat"
if not exist "%VSDEVCMD%" (
  echo Microsoft C++ Build Tools was not found.
  echo Install the Visual Studio Build Tools C++ workload, then run this command again.
  exit /b 1
)

call "%VSDEVCMD%" -arch=x64 -host_arch=x64
if errorlevel 1 exit /b %errorlevel%

if not exist "%~dp0build\Release" mkdir "%~dp0build\Release"
cl /nologo /std:c++17 /O2 /EHsc "%~dp0main.cpp" /Fe:"%~dp0build\Release\cutting_optimizer.exe"
