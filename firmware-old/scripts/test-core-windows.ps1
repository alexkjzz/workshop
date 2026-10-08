param(
  [string]$ZigPath = '',
  [string]$UnityDir = '',
  [string]$ArduinoJsonDir = ''
)

# Compile et execute les vrais tests Unity sur Windows, sans carte ni GCC global.
# Zig est un compilateur portable ; ce script ne telecharge et n'installe rien.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$taskFirmwareRoot = Split-Path -Parent $PSScriptRoot
$taskWorkspaceRoot = Split-Path -Parent $taskFirmwareRoot

if (-not $ZigPath) {
  $taskZigCommand = Get-Command zig -ErrorAction SilentlyContinue
  if ($taskZigCommand) {
    $ZigPath = $taskZigCommand.Source
  } else {
    $ZigPath = Join-Path $taskWorkspaceRoot '.runtime\firmware-tools\zig-x86_64-windows-0.14.1\zig.exe'
  }
}
if (-not (Test-Path -LiteralPath $ZigPath -PathType Leaf)) {
  throw 'Compilateur Zig absent. Utiliser -ZigPath avec le chemin de zig.exe (https://ziglang.org/download/).'
}
if (-not $UnityDir) {
  foreach ($taskEnvironment in @('native', 'nodemcuv2-local', 'nodemcuv2')) {
    $taskCandidate = Join-Path $taskFirmwareRoot ".pio\libdeps\$taskEnvironment\Unity\src"
    if (Test-Path -LiteralPath (Join-Path $taskCandidate 'unity.c')) {
      $UnityDir = $taskCandidate
      break
    }
  }
}
if (-not $UnityDir -or -not (Test-Path -LiteralPath (Join-Path $UnityDir 'unity.c'))) {
  throw 'Unity absent. Compiler d abord le firmware avec PlatformIO, ou fournir -UnityDir.'
}
if (-not $ArduinoJsonDir) {
  foreach ($taskEnvironment in @('native', 'nodemcuv2-local', 'nodemcuv2')) {
    $taskCandidate = Join-Path $taskFirmwareRoot ".pio\libdeps\$taskEnvironment\ArduinoJson\src"
    if (Test-Path -LiteralPath (Join-Path $taskCandidate 'ArduinoJson.h')) {
      $ArduinoJsonDir = $taskCandidate
      break
    }
  }
}
if (-not $ArduinoJsonDir -or -not (Test-Path -LiteralPath (Join-Path $ArduinoJsonDir 'ArduinoJson.h'))) {
  throw 'ArduinoJson absent. Compiler le firmware avec PlatformIO, ou fournir -ArduinoJsonDir.'
}

$taskBuildDir = Join-Path $taskWorkspaceRoot '.runtime\firmware-native-tests'
$taskCacheDir = Join-Path $taskBuildDir 'zig-cache'
New-Item -ItemType Directory -Path $taskBuildDir -Force | Out-Null
$taskPreviousCache = $env:ZIG_GLOBAL_CACHE_DIR
$taskCoreRoot = Join-Path $taskFirmwareRoot 'lib\sentinel_core\src'
$taskUnityObject = Join-Path $taskBuildDir 'unity.obj'
$taskTestExecutable = Join-Path $taskBuildDir 'test-core.exe'
$taskSources = @(Get-ChildItem -LiteralPath $taskCoreRoot -Recurse -File -Filter '*.cpp' | ForEach-Object { $_.FullName })
$taskSources += Join-Path $taskFirmwareRoot 'test\test_core\test_main.cpp'
$taskInfrastructureRoot = Join-Path $taskFirmwareRoot 'src'
$taskSources += Join-Path $taskInfrastructureRoot 'infrastructure\telemetry_payload.cpp'

try {
  $env:ZIG_GLOBAL_CACHE_DIR = $taskCacheDir
  & $ZigPath cc -std=c99 '-I' $UnityDir -c (Join-Path $UnityDir 'unity.c') -o $taskUnityObject
  if ($LASTEXITCODE -ne 0) { throw 'Echec de compilation Unity.' }
  & $ZigPath c++ -std=c++17 -Wall -Wextra -Werror '-I' $taskCoreRoot '-I' $UnityDir '-I' $ArduinoJsonDir '-I' $taskInfrastructureRoot @taskSources $taskUnityObject -o $taskTestExecutable
  if ($LASTEXITCODE -ne 0) { throw 'Echec de compilation des tests C++.' }
  & $taskTestExecutable
  if ($LASTEXITCODE -ne 0) { throw 'Les tests du firmware ont echoue.' }
} finally {
  if ($null -eq $taskPreviousCache) {
    Remove-Item Env:ZIG_GLOBAL_CACHE_DIR -ErrorAction SilentlyContinue
  } else {
    $env:ZIG_GLOBAL_CACHE_DIR = $taskPreviousCache
  }
}
