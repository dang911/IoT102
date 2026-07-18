param(
  [Parameter(Mandatory = $true)][string]$InputPath,
  [Parameter(Mandatory = $true)][string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$wdFormatDocumentDefault = 16
$word = $null
$doc = $null
$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("iot102-md-docx-" + [guid]::NewGuid())

function Encode([string]$text) {
  return [System.Net.WebUtility]::HtmlEncode($text)
}

function Inline-Markdown([string]$text) {
  $value = Encode $text
  $value = [regex]::Replace($value, '``([^`]+)``', '<code>$1</code>')
  $value = [regex]::Replace($value, '`([^`]+)`', '<code>$1</code>')
  $value = [regex]::Replace($value, '\*\*([^*]+)\*\*', '<strong>$1</strong>')
  $value = [regex]::Replace($value, '(?<!\*)\*([^*]+)\*(?!\*)', '<em>$1</em>')
  return $value
}

function Table-Cells([string]$line) {
  $trimmed = $line.Trim().Trim('|')
  return @($trimmed.Split('|') | ForEach-Object { $_.Trim() })
}

try {
  New-Item -ItemType Directory -Path $tempDir | Out-Null
  $resolvedInput = (Resolve-Path -LiteralPath $InputPath).Path
  $resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
  $outputDirectory = [System.IO.Path]::GetDirectoryName($resolvedOutput)
  if (-not (Test-Path -LiteralPath $outputDirectory)) {
    New-Item -ItemType Directory -Path $outputDirectory | Out-Null
  }

  $markdown = [System.IO.File]::ReadAllText($resolvedInput, [Text.Encoding]::UTF8)
  $imageMap = @{}
  foreach ($match in [regex]::Matches($markdown, '(?m)^\[([^]]+)\]:\s*<data:image/([^;]+);base64,([^>]+)>\s*$')) {
    $id = $match.Groups[1].Value
    $extension = $match.Groups[2].Value.Replace('jpeg', 'jpg')
    $imagePath = Join-Path $tempDir ($id + '.' + $extension)
    [System.IO.File]::WriteAllBytes($imagePath, [Convert]::FromBase64String($match.Groups[3].Value))
    $imageMap[$id] = $imagePath
  }
  $markdown = [regex]::Replace($markdown, '(?m)^\[[^]]+\]:\s*<data:image/[^;]+;base64,[^>]+>\s*$', '')
  $lines = @($markdown -split "`r?`n")

  $body = [Text.StringBuilder]::new()
  [void]$body.AppendLine('<h1 class="report-title">Smart Environment Monitoring &amp; Lighting Control System</h1>')
  [void]$body.AppendLine('<p class="subtitle">IoT System Technical Report</p>')
  $i = 0
  $listType = $null
  while ($i -lt $lines.Count) {
    $line = $lines[$i]
    if ($line -match '^\s*$') {
      if ($listType) { [void]$body.AppendLine("</$listType>"); $listType = $null }
      $i++; continue
    }
    if ($line -match '^---\s*$') {
      if ($listType) { [void]$body.AppendLine("</$listType>"); $listType = $null }
      [void]$body.AppendLine('<hr>'); $i++; continue
    }
    if ($line -match '^(#{1,6})\s+(.+)$') {
      if ($listType) { [void]$body.AppendLine("</$listType>"); $listType = $null }
      $level = [Math]::Min(3, $matches[1].Length)
      $heading = $matches[2] -replace '^\*\*|\*\*$', ''
      [void]$body.AppendLine("<h$level>$(Inline-Markdown $heading)</h$level>")
      $i++; continue
    }
    if ($line -match '^!\[.*?\]\[([^]]+)\]$') {
      if ($listType) { [void]$body.AppendLine("</$listType>"); $listType = $null }
      $id = $matches[1]
      if ($imageMap.ContainsKey($id)) {
        $uri = ([uri]$imageMap[$id]).AbsoluteUri
        [void]$body.AppendLine("<p class='figure'><img src='$uri' alt='$id'></p>")
      }
      $i++; continue
    }
    if ($line.TrimStart().StartsWith('|') -and $i + 1 -lt $lines.Count -and $lines[$i + 1] -match '^\s*\|?\s*:?-+') {
      if ($listType) { [void]$body.AppendLine("</$listType>"); $listType = $null }
      $headers = Table-Cells $line
      [void]$body.AppendLine('<table><thead><tr>')
      foreach ($cell in $headers) { [void]$body.AppendLine("<th>$(Inline-Markdown $cell)</th>") }
      [void]$body.AppendLine('</tr></thead><tbody>')
      $i += 2
      while ($i -lt $lines.Count -and $lines[$i].TrimStart().StartsWith('|')) {
        [void]$body.AppendLine('<tr>')
        foreach ($cell in (Table-Cells $lines[$i])) { [void]$body.AppendLine("<td>$(Inline-Markdown $cell)</td>") }
        [void]$body.AppendLine('</tr>')
        $i++
      }
      [void]$body.AppendLine('</tbody></table>')
      continue
    }
    if ($line -match '^\s*[*+-]\s+(.+)$') {
      if ($listType -ne 'ul') {
        if ($listType) { [void]$body.AppendLine("</$listType>") }
        [void]$body.AppendLine('<ul>'); $listType = 'ul'
      }
      [void]$body.AppendLine("<li>$(Inline-Markdown $matches[1])</li>")
      $i++; continue
    }
    if ($line -match '^\s*\d+\.\s+(.+)$') {
      if ($listType -ne 'ol') {
        if ($listType) { [void]$body.AppendLine("</$listType>") }
        [void]$body.AppendLine('<ol>'); $listType = 'ol'
      }
      [void]$body.AppendLine("<li>$(Inline-Markdown $matches[1])</li>")
      $i++; continue
    }
    if ($listType) { [void]$body.AppendLine("</$listType>"); $listType = $null }
    [void]$body.AppendLine("<p>$(Inline-Markdown $line.Trim())</p>")
    $i++
  }
  if ($listType) { [void]$body.AppendLine("</$listType>") }

  $html = @"
<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: 8.5in 11in; margin: 1in; }
body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; line-height: 1.10; color: #20252b; }
.report-title { font-size: 26pt; color: #0B2545; text-align: center; margin: 72pt 0 8pt; page-break-after: avoid; }
.subtitle { font-size: 14pt; color: #59636e; text-align: center; margin: 0 0 48pt; }
h1 { font-size: 16pt; color: #2E74B5; margin: 16pt 0 8pt; page-break-after: avoid; }
h2 { font-size: 13pt; color: #2E74B5; margin: 12pt 0 6pt; page-break-after: avoid; }
h3 { font-size: 12pt; color: #1F4D78; margin: 8pt 0 4pt; page-break-after: avoid; }
p { margin: 0 0 6pt; }
ul, ol { margin: 0 0 8pt 0.5in; }
li { margin-bottom: 4pt; }
table { width: 100%; border-collapse: collapse; margin: 6pt 0 10pt; page-break-inside: auto; }
th, td { border: 0.6pt solid #9aa5b1; padding: 5pt 6pt; vertical-align: middle; }
th { background: #F2F4F7; color: #0B2545; font-weight: bold; text-align: left; }
code { font-family: Consolas, monospace; font-size: 9pt; background: #F2F4F7; }
hr { border: 0; border-top: 0.5pt solid #d8dde3; margin: 10pt 0; }
.figure { text-align: center; page-break-inside: avoid; margin: 8pt 0; }
.figure img { max-width: 6.2in; max-height: 7.6in; }
</style></head><body>$($body.ToString())</body></html>
"@
  $htmlPath = Join-Path $tempDir 'report.html'
  [System.IO.File]::WriteAllText($htmlPath, $html, [Text.UTF8Encoding]::new($false))

  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $doc = $word.Documents.Open($htmlPath)
  foreach ($section in $doc.Sections) {
    $section.PageSetup.TopMargin = 72
    $section.PageSetup.BottomMargin = 72
    $section.PageSetup.LeftMargin = 72
    $section.PageSetup.RightMargin = 72
    $section.PageSetup.HeaderDistance = 35.4
    $section.PageSetup.FooterDistance = 35.4
    $footer = $section.Footers.Item(1).Range
    $footer.Text = 'Smart Environment Monitoring & Lighting Control System'
    $footer.Font.Name = 'Calibri'
    $footer.Font.Size = 8
    $footer.Font.Color = 8421504
    $footer.ParagraphFormat.Alignment = 2
  }
  foreach ($table in $doc.Tables) {
    $table.AllowAutoFit = $true
    $table.Rows.Item(1).HeadingFormat = $true
    $table.TopPadding = 4
    $table.BottomPadding = 4
    $table.LeftPadding = 6
    $table.RightPadding = 6
  }
  foreach ($field in $doc.Fields) { try { [void]$field.Update() } catch {} }
  if (Test-Path -LiteralPath $resolvedOutput) { Remove-Item -LiteralPath $resolvedOutput -Force }
  $doc.SaveAs2($resolvedOutput, $wdFormatDocumentDefault)
  Write-Output "OUTPUT=$resolvedOutput"
  Write-Output "PAGES=$($doc.ComputeStatistics(2)) TABLES=$($doc.Tables.Count) IMAGES=$($doc.InlineShapes.Count)"
}
finally {
  if ($doc) { $doc.Close($false) }
  if ($word) { $word.Quit() }
  if ($doc) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($doc) }
  if ($word) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($word) }
  if (Test-Path -LiteralPath $tempDir) { Remove-Item -LiteralPath $tempDir -Recurse -Force }
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}
