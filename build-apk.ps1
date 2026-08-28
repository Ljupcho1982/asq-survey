# Builds ASQ Survey as an Android debug APK. Run from the asq/ folder.
$ErrorActionPreference = 'Stop'

# ANDROID_HOME on this machine points at an empty SDK under Program Files.
# The real one is in LOCALAPPDATA; without this, gradle tries to install
# components into a folder it cannot write to and fails with a useless message.
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"

# The JDK path is not hard-coded: gradle can exit 0 with a wrong JAVA_HOME, so
# candidates are searched and then checked for an actual java.exe.
$jdkCandidates = @(
  $env:JAVA_HOME,
  (Get-ChildItem "$env:USERPROFILE\.jdks" -Directory -EA SilentlyContinue |
     Where-Object { $_.Name -match '21' } | Select-Object -First 1 -Exp FullName),
  (Get-ChildItem 'C:\Program Files\Eclipse Adoptium' -Directory -EA SilentlyContinue |
     Where-Object { $_.Name -match 'jdk-21' } | Select-Object -First 1 -Exp FullName),
  'C:\Program Files\Android\Android Studio\jbr'
) | Where-Object { $_ }

$jdk = $jdkCandidates | Where-Object { Test-Path (Join-Path $_ 'bin\java.exe') } | Select-Object -First 1
if (-not $jdk) { throw "No JDK 21 found. Install one, or set JAVA_HOME." }
$env:JAVA_HOME = $jdk.TrimEnd('\')
Write-Host "==> JDK: $env:JAVA_HOME" -ForegroundColor Cyan

# An old service-worker cache pins tablets to the previous build, so the cache
# name tracks the version in package.json.
$pkgVersion = (Get-Content package.json -Raw | ConvertFrom-Json).version
$sw = Get-Content www\sw.js -Raw
if ($sw -notmatch "asq-v$([regex]::Escape($pkgVersion))") {
  Write-Host "==> stamping cache version: $pkgVersion" -ForegroundColor Cyan
  $sw = $sw -replace 'const CACHE = "asq-v[^"]*"', "const CACHE = `"asq-v$pkgVersion`""
  Set-Content www\sw.js $sw -NoNewline
}

Write-Host "==> selftest" -ForegroundColor Cyan
node tools\selftest.js
if ($LASTEXITCODE -ne 0) { throw "selftest failed - not building an APK on a broken instrument." }

if (-not (Test-Path android)) {
  Write-Host "==> adding android platform" -ForegroundColor Cyan
  npx cap add android
}

# The SDK path has to be in local.properties, otherwise the wrong system-wide
# ANDROID_HOME wins (see above).
$localProps = 'android\local.properties'
$sdkLine = 'sdk.dir=' + ($env:ANDROID_HOME -replace '\\', '\\' -replace ':', '\:')
if (-not (Test-Path $localProps) -or (Get-Content $localProps -Raw) -notmatch 'sdk\.dir') {
  Write-Host "==> writing android/local.properties" -ForegroundColor Cyan
  Set-Content $localProps $sdkLine -NoNewline
}

Write-Host "==> syncing web assets" -ForegroundColor Cyan
npx cap sync android

# Launcher icons are vector drawables, not PNG - there is no SVG rasterizer on
# this machine, so the mipmaps cannot be generated from the image.
Write-Host "==> installing vector launcher icons" -ForegroundColor Cyan
$res = 'android\app\src\main\res'
Copy-Item android-res\* $res -Recurse -Force
# -Filter with a wildcard in the FOLDER path returns nothing in PowerShell; this
# must be -Recurse over the res root or the default PNG icons silently survive.
Get-ChildItem $res -Recurse -Filter 'ic_launcher*.png' -EA SilentlyContinue | Remove-Item -Force

Write-Host "==> gradle assembleDebug" -ForegroundColor Cyan
Set-Location android
.\gradlew.bat assembleDebug
$gradleExit = $LASTEXITCODE
Set-Location ..
if ($gradleExit -ne 0) { throw "gradle assembleDebug failed with code $gradleExit" }

Copy-Item android\app\build\outputs\apk\debug\app-debug.apk .\ASQ-debug.apk -Force
Write-Host "==> done: ASQ-debug.apk" -ForegroundColor Green
Get-Item .\ASQ-debug.apk | Select-Object Name, Length, LastWriteTime
