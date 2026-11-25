# Regenerates the Android launcher icons + splash screens of both apps from the ShopFlow logo
# (master: packages/shared/brand/logo.svg — keep the geometry below in sync with it).
# Windows only (System.Drawing). Run from the repo root:  powershell -File scripts/brand-icons.ps1
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'

$Blue   = [System.Drawing.ColorTranslator]::FromHtml('#2563eb')
$Orange = [System.Drawing.ColorTranslator]::FromHtml('#f97316')
$SplashBg = [System.Drawing.ColorTranslator]::FromHtml('#f5f8ff')

function New-Canvas([int]$w, [int]$h) {
  $bmp = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.PixelOffsetMode = 'HighQuality'; $g.InterpolationMode = 'HighQualityBicubic'
  $g.Clear([System.Drawing.Color]::Transparent)
  return @($bmp, $g)
}

function Add-RoundRect($g, [double]$x, [double]$y, [double]$size, [double]$r, $color) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = 2 * $r
  $p.AddArc($x, $y, $d, $d, 180, 90); $p.AddArc($x + $size - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $size - $d, $y + $size - $d, $d, $d, 0, 90); $p.AddArc($x, $y + $size - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  $g.FillPath((New-Object System.Drawing.SolidBrush $color), $p)
}

# Bars + dot of the logo, in 64-unit space, placed at ($ox,$oy) with $s px per unit.
function Add-Glyph($g, [double]$ox, [double]$oy, [double]$s) {
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), (6 * $s)
  $pen.StartCap = 'Round'; $pen.EndCap = 'Round'
  foreach ($b in @(@(17, 33), @(27, 22.1), @(37, 28.1), @(47, 23))) {
    $g.DrawLine($pen, [single]($ox + $b[0] * $s), [single]($oy + $b[1] * $s), [single]($ox + $b[0] * $s), [single]($oy + 45.75 * $s))
  }
  $r = 4.1 * $s
  $g.FillEllipse((New-Object System.Drawing.SolidBrush $Orange), [single]($ox + 46.9 * $s - $r), [single]($oy + 15.9 * $s - $r), [single](2 * $r), [single](2 * $r))
}

function Save($bmp, $g, [string]$path) { $g.Dispose(); $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose() }

$densities = @{ mdpi = 1; hdpi = 1.5; xhdpi = 2; xxhdpi = 3; xxxhdpi = 4 }
$root = Split-Path $PSScriptRoot -Parent

foreach ($app in 'boss', 'pos') {
  $res = Join-Path $root "apps/$app/android/app/src/main/res"
  if (-not (Test-Path $res)) { Write-Host "skip $app (no android project)"; continue }
  foreach ($d in $densities.Keys) {
    $k = $densities[$d]; $dir = Join-Path $res "mipmap-$d"
    # Legacy square icon (pre-Android 8)
    $L = [int](48 * $k); $c = New-Canvas $L $L
    Add-RoundRect $c[1] 0 0 $L ($L * 14 / 64) $Blue; Add-Glyph $c[1] 0 0 ($L / 64)
    Save $c[0] $c[1] (Join-Path $dir 'ic_launcher.png')
    # Legacy round icon
    $c = New-Canvas $L $L
    $c[1].FillEllipse((New-Object System.Drawing.SolidBrush $Blue), 0, 0, $L, $L)
    $s = $L * 0.84 / 64; $o = ($L - 64 * $s) / 2; Add-Glyph $c[1] $o $o $s
    Save $c[0] $c[1] (Join-Path $dir 'ic_launcher_round.png')
    # Adaptive foreground (108dp canvas, background colour comes from values/ic_launcher_background.xml)
    $F = [int](108 * $k); $c = New-Canvas $F $F
    $s = ($F * 66 / 108) / 64; $o = ($F - 64 * $s) / 2; Add-Glyph $c[1] $o $o $s
    Save $c[0] $c[1] (Join-Path $dir 'ic_launcher_foreground.png')
  }
  $bgXml = Join-Path $res 'values/ic_launcher_background.xml'
  [IO.File]::WriteAllText($bgXml, "<?xml version=`"1.0`" encoding=`"utf-8`"?>`n<resources>`n    <color name=`"ic_launcher_background`">#2563EB</color>`n</resources>`n")
  # Splash screens: keep each file's existing size, light background + centred logo
  Get-ChildItem $res -Recurse -Filter splash.png | ForEach-Object {
    $old = [System.Drawing.Image]::FromFile($_.FullName); $w = $old.Width; $h = $old.Height; $old.Dispose()
    $c = New-Canvas $w $h; $c[1].Clear($SplashBg)
    $size = [Math]::Min($w, $h) * 0.28; $x = ($w - $size) / 2; $y = ($h - $size) / 2
    Add-RoundRect $c[1] $x $y $size ($size * 14 / 64) $Blue; Add-Glyph $c[1] $x $y ($size / 64)
    Save $c[0] $c[1] $_.FullName
  }
  Write-Host "ok $app"
}
