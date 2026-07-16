param(
  [Parameter(Mandatory = $true)][string]$InputPath,
  [Parameter(Mandatory = $true)][string]$OutputDirectory,
  [int]$FirstPage = 1,
  [int]$LastPage = 0
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$wdGoToPage = 1
$wdGoToAbsolute = 1
$word = $null
$doc = $null

try {
  $input = (Resolve-Path -LiteralPath $InputPath).Path
  $output = [System.IO.Path]::GetFullPath($OutputDirectory)
  if (-not (Test-Path -LiteralPath $output)) {
    New-Item -ItemType Directory -Path $output -Force | Out-Null
  }

  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $doc = $word.Documents.Open($input, $false, $true)
  $doc.Repaginate()
  $pageCount = $doc.ComputeStatistics(2)
  if ($LastPage -le 0 -or $LastPage -gt $pageCount) { $LastPage = $pageCount }

  for ($page = $FirstPage; $page -le $LastPage; $page++) {
    $start = $doc.GoTo($wdGoToPage, $wdGoToAbsolute, $page).Start
    if ($page -lt $pageCount) {
      $end = $doc.GoTo($wdGoToPage, $wdGoToAbsolute, $page + 1).Start - 1
    } else {
      $end = $doc.Content.End - 1
    }

    $range = $doc.Range($start, $end)
    $range.CopyAsPicture()
    Start-Sleep -Milliseconds 250
    $image = [System.Windows.Forms.Clipboard]::GetImage()
    if (-not $image) {
      throw "Clipboard did not contain an image for page $page"
    }
    $path = Join-Path $output ('page-{0:D2}.png' -f $page)
    $image.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $image.Dispose()
    Write-Output $path
  }
}
finally {
  if ($doc) { $doc.Close($false) }
  if ($word) { $word.Quit() }
  if ($doc) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($doc) }
  if ($word) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($word) }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
