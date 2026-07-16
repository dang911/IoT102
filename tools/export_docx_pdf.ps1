param(
  [Parameter(Mandatory = $true)][string]$InputPath,
  [Parameter(Mandatory = $true)][string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$word = $null
$doc = $null

try {
  $input = (Resolve-Path -LiteralPath $InputPath).Path
  $output = [System.IO.Path]::GetFullPath($OutputPath)
  $directory = [System.IO.Path]::GetDirectoryName($output)
  if (-not (Test-Path -LiteralPath $directory)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
  }
  if (Test-Path -LiteralPath $output) {
    Remove-Item -LiteralPath $output -Force
  }

  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $word.Options.PrintBackground = $false
  $doc = $word.Documents.Open($input, $false, $true)
  $doc.Repaginate()
  $doc.ExportAsFixedFormat($output, 17, $false, 0, 0, 1, $doc.ComputeStatistics(2), 0, $true, $true, 0, $true, $true, $false)
  Write-Output "PDF=$output"
}
finally {
  if ($doc) { $doc.Close($false) }
  if ($word) { $word.Quit() }
  if ($doc) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($doc) }
  if ($word) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($word) }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
