param(
  [string]$OutputDirectory = ""
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  $OutputDirectory = Join-Path $root "dist"
}

$outputDirPath = [System.IO.Path]::GetFullPath($OutputDirectory)
$rootPath = [System.IO.Path]::GetFullPath($root)
$distInRoot = $outputDirPath.StartsWith($rootPath, [System.StringComparison]::OrdinalIgnoreCase)

if (-not (Test-Path -LiteralPath (Join-Path $root "manifest.json"))) {
  throw "manifest.json not found. Keep this script in the extension root."
}

$manifest = Get-Content -LiteralPath (Join-Path $root "manifest.json") -Raw | ConvertFrom-Json
$name = ($manifest.name -replace '[^\w.-]+', '-').Trim("-")
$version = ($manifest.version -replace '[^\w.-]+', '-').Trim("-")
if ([string]::IsNullOrWhiteSpace($name)) { $name = "chrome-extension" }
if ([string]::IsNullOrWhiteSpace($version)) { $version = "dev" }

New-Item -ItemType Directory -Force -Path $outputDirPath | Out-Null
$zipPath = Join-Path $outputDirPath "$name-$version.zip"

$requiredFiles = @(
  "manifest.json",
  "popup.html",
  "popup.css",
  "popup.js",
  "content.js",
  "map.html",
  "map.css",
  "map.js"
)

foreach ($file in $requiredFiles) {
  if (-not (Test-Path -LiteralPath (Join-Path $root $file))) {
    throw "Required extension file is missing: $file"
  }
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("house-scout-package-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null

try {
  $items = Get-ChildItem -LiteralPath $root -Force | Where-Object {
    $_.Name -notin @(".git", ".gitignore", "dist") -and
    $_.Name -notlike "*.zip" -and
    $_.Name -ne "package-extension.ps1"
  }

  foreach ($item in $items) {
    if ($distInRoot -and $item.FullName.StartsWith($outputDirPath, [System.StringComparison]::OrdinalIgnoreCase)) {
      continue
    }
    Copy-Item -LiteralPath $item.FullName -Destination $tempRoot -Recurse -Force
  }

  if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
  }

  Compress-Archive -Path (Join-Path $tempRoot "*") -DestinationPath $zipPath -Force
  Write-Host "Created package: $zipPath"
  Write-Host "Users can unzip it anywhere. Chrome resolves extension files from the selected extension root."
} finally {
  if (Test-Path -LiteralPath $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}
