$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$docsDir = Join-Path $repoRoot 'docs'
$generatedDate = Get-Date
$stamp = $generatedDate.ToString('yyyyMMdd-HHmmss')
$docxPath = Join-Path $docsDir "KVSK-ERP-System-Documentation-$stamp.docx"
$pptxPath = Join-Path $docsDir "KVSK-ERP-System-Presentation-$stamp.pptx"
$generatedDateUtc = $generatedDate.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$generatedDateLong = $generatedDate.ToString('MMMM d, yyyy')

New-Item -ItemType Directory -Path $docsDir -Force | Out-Null

function Escape-XmlText {
  param([string]$Text)
  if ($null -eq $Text) { return '' }
  return [System.Security.SecurityElement]::Escape($Text)
}

function ConvertTo-RgbInt {
  param([string]$Hex)
  $clean = $Hex.Trim().TrimStart('#')
  return [Convert]::ToInt32($clean, 16)
}

function New-DocxRun {
  param(
    [string]$Text,
    [int]$SizePt = 11,
    [string]$Color = '000000',
    [switch]$Bold,
    [switch]$Italic,
    [switch]$Underline
  )

  $halfPoints = [int]($SizePt * 2)
  $parts = @(
    "<w:rFonts w:ascii=`"Calibri`" w:hAnsi=`"Calibri`" />",
    "<w:sz w:val=`"$halfPoints`" />",
    "<w:szCs w:val=`"$halfPoints`" />",
    "<w:color w:val=`"$Color`" />"
  )
  if ($Bold) { $parts += '<w:b />' }
  if ($Italic) { $parts += '<w:i />' }
  if ($Underline) { $parts += '<w:u w:val="single" />' }
  $runProps = "<w:rPr>$($parts -join '')</w:rPr>"
  $escaped = Escape-XmlText $Text
  return "<w:r>$runProps<w:t xml:space=`"preserve`">$escaped</w:t></w:r>"
}

function New-DocxParagraph {
  param(
    [string]$Text = '',
    [int]$SizePt = 11,
    [string]$Color = '000000',
    [switch]$Bold,
    [switch]$Italic,
    [string]$Align = 'left',
    [int]$Before = 0,
    [int]$After = 120,
    [int]$Left = -1,
    [int]$Hanging = -1,
    [switch]$PageBreak
  )

  if ($PageBreak) {
    return '<w:p><w:r><w:br w:type="page" /></w:r></w:p>'
  }

  $pPrParts = @()
  if ($Align) {
    $pPrParts += "<w:jc w:val=`"$Align`" />"
  }
  if ($Before -ge 0 -or $After -ge 0) {
    $pPrParts += "<w:spacing w:before=`"$Before`" w:after=`"$After`" />"
  }
  if ($Left -ge 0) {
    if ($Hanging -ge 0) {
      $pPrParts += "<w:ind w:left=`"$Left`" w:hanging=`"$Hanging`" />"
    } else {
      $pPrParts += "<w:ind w:left=`"$Left`" />"
    }
  }

  $pPr = if ($pPrParts.Count) { "<w:pPr>$($pPrParts -join '')</w:pPr>" } else { '' }
  $run = New-DocxRun -Text $Text -SizePt $SizePt -Color $Color -Bold:$Bold -Italic:$Italic
  return "<w:p>$pPr$run</w:p>"
}

function New-DocxStylesXml {
  return @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" />
        <w:sz w:val="22" />
        <w:szCs w:val="22" />
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr>
        <w:spacing w:after="120" />
      </w:pPr>
    </w:pPrDefault>
  </w:docDefaults>
</w:styles>
"@
}

function New-DocxCoreXml {
  param([string]$Title, [string]$Subject, [string]$Creator)
  return @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>$(Escape-XmlText $Title)</dc:title>
  <dc:subject>$(Escape-XmlText $Subject)</dc:subject>
  <dc:creator>$(Escape-XmlText $Creator)</dc:creator>
  <cp:lastModifiedBy>Codex</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">$generatedDateUtc</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">$generatedDateUtc</dcterms:modified>
</cp:coreProperties>
"@
}

function New-DocxAppXml {
  param([string]$Title)
  return @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Microsoft Office Word</Application>
  <DocSecurity>0</DocSecurity>
  <ScaleCrop>false</ScaleCrop>
  <HeadingPairs>
    <vt:vector size="2" baseType="variant">
      <vt:variant><vt:lpstr>Title</vt:lpstr></vt:variant>
      <vt:variant><vt:i4>1</vt:i4></vt:variant>
    </vt:vector>
  </HeadingPairs>
  <TitlesOfParts>
    <vt:vector size="1" baseType="lpstr">
      <vt:lpstr>$(Escape-XmlText $Title)</vt:lpstr>
    </vt:vector>
  </TitlesOfParts>
  <Company>KVSK CCTV &amp; IT Solution</Company>
  <LinksUpToDate>false</LinksUpToDate>
  <SharedDoc>false</SharedDoc>
  <HyperlinksChanged>false</HyperlinksChanged>
  <AppVersion>16.0000</AppVersion>
</Properties>
"@
}

function New-DocxDocumentXml {
  param([string[]]$Paragraphs)

  $body = $Paragraphs -join "`n"
  return @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
$body
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840" />
      <w:pgMar w:top="1440" w:right="1080" w:bottom="1440" w:left="1080" w:header="720" w:footer="720" w:gutter="0" />
      <w:cols w:space="720" />
      <w:docGrid w:linePitch="360" />
    </w:sectPr>
  </w:body>
</w:document>
"@
}

function Add-ZipTextEntry {
  param(
    [System.IO.Compression.ZipArchive]$Zip,
    [string]$EntryName,
    [string]$Text
  )

  $entry = $Zip.CreateEntry($EntryName)
  $stream = $entry.Open()
  try {
    $encoding = New-Object System.Text.UTF8Encoding($false)
    $writer = New-Object System.IO.StreamWriter($stream, $encoding)
    try {
      $writer.Write($Text)
    } finally {
      $writer.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
}

function Write-DocxFile {
  param(
    [string]$Path,
    [string]$Title,
    [string[]]$Paragraphs
  )

  if (Test-Path $Path) {
    Remove-Item -LiteralPath $Path -Force
  }

  $zip = [System.IO.Compression.ZipFile]::Open($Path, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    Add-ZipTextEntry $zip '[Content_Types].xml' @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="xml" ContentType="application/xml" />
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml" />
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml" />
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml" />
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml" />
</Types>
"@

    Add-ZipTextEntry $zip '_rels/.rels' @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml" />
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml" />
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml" />
</Relationships>
"@

    Add-ZipTextEntry $zip 'docProps/core.xml' (New-DocxCoreXml -Title $Title -Subject 'ERP System Documentation' -Creator 'Codex')
    Add-ZipTextEntry $zip 'docProps/app.xml' (New-DocxAppXml -Title $Title)
    Add-ZipTextEntry $zip 'word/styles.xml' (New-DocxStylesXml)
    Add-ZipTextEntry $zip 'word/_rels/document.xml.rels' @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships" />
"@
    Add-ZipTextEntry $zip 'word/document.xml' (New-DocxDocumentXml -Paragraphs $Paragraphs)
  } finally {
    $zip.Dispose()
  }
}

function Add-PptShapeTextBox {
  param(
    [object]$Slide,
    [double]$Left,
    [double]$Top,
    [double]$Width,
    [double]$Height,
    [string]$Text,
    [int]$FontSize = 18,
    [string]$FontColor = '2E3A4A',
    [string]$FontName = 'Calibri',
    [switch]$Bold,
    [string]$Align = 'left'
  )

  $textbox = $Slide.Shapes.AddTextbox(1, $Left, $Top, $Width, $Height)
  $textbox.TextFrame.WordWrap = -1
  $textbox.TextFrame.MarginLeft = 4
  $textbox.TextFrame.MarginRight = 4
  $textbox.TextFrame.MarginTop = 2
  $textbox.TextFrame.MarginBottom = 2
  $textbox.Line.Visible = 0
  $textbox.Fill.Visible = 0
  $textbox.TextFrame.TextRange.Text = $Text
  $textbox.TextFrame.TextRange.Font.Name = $FontName
  $textbox.TextFrame.TextRange.Font.Size = $FontSize
  $textbox.TextFrame.TextRange.Font.Bold = if ($Bold) { -1 } else { 0 }
  $textbox.TextFrame.TextRange.Font.Color.RGB = (ConvertTo-RgbInt $FontColor)
  switch ($Align.ToLowerInvariant()) {
    'center' { $textbox.TextFrame.TextRange.ParagraphFormat.Alignment = 2 }
    'right' { $textbox.TextFrame.TextRange.ParagraphFormat.Alignment = 3 }
    default { $textbox.TextFrame.TextRange.ParagraphFormat.Alignment = 1 }
  }
  return $textbox
}

function Add-PptImage {
  param(
    [object]$Slide,
    [string]$Path,
    [double]$Left,
    [double]$Top,
    [double]$Width,
    [double]$Height
  )

  if (-not (Test-Path $Path)) {
    return $null
  }

  return $Slide.Shapes.AddPicture($Path, $false, $true, $Left, $Top, $Width, $Height)
}

function Add-PptRect {
  param(
    [object]$Slide,
    [double]$Left,
    [double]$Top,
    [double]$Width,
    [double]$Height,
    [string]$FillColor,
    [string]$LineColor = $null,
    [switch]$Rounded
  )

  $shapeType = if ($Rounded) { 5 } else { 1 }
  $shape = $Slide.Shapes.AddShape($shapeType, $Left, $Top, $Width, $Height)
  $shape.Fill.Solid()
  $shape.Fill.ForeColor.RGB = (ConvertTo-RgbInt $FillColor)
  if ($LineColor) {
    $shape.Line.Visible = -1
    $shape.Line.ForeColor.RGB = (ConvertTo-RgbInt $LineColor)
  } else {
    $shape.Line.Visible = 0
  }
  return $shape
}

function Add-PptPill {
  param(
    [object]$Slide,
    [double]$Left,
    [double]$Top,
    [double]$Width,
    [double]$Height,
    [string]$Text,
    [string]$FillColor,
    [string]$LineColor = 'D9E6F7',
    [string]$FontColor = '1F4E79',
    [int]$FontSize = 12,
    [switch]$Bold
  )

  $pill = Add-PptRect -Slide $Slide -Left $Left -Top $Top -Width $Width -Height $Height -FillColor $FillColor -LineColor $LineColor -Rounded
  $pill.TextFrame.TextRange.Text = $Text
  $pill.TextFrame.TextRange.Font.Name = 'Bahnschrift SemiBold'
  $pill.TextFrame.TextRange.Font.Size = $FontSize
  $pill.TextFrame.TextRange.Font.Bold = if ($Bold) { -1 } else { 0 }
  $pill.TextFrame.TextRange.Font.Color.RGB = (ConvertTo-RgbInt $FontColor)
  $pill.TextFrame.TextRange.ParagraphFormat.Alignment = 2
  return $pill
}

function Add-UiCard {
  param(
    [object]$Slide,
    [double]$Left,
    [double]$Top,
    [double]$Width,
    [double]$Height,
    [string]$Label,
    [string]$Value,
    [string]$MiniText = '',
    [string]$FillColor = '1F4E79',
    [string]$ValueColor = 'FFFFFF',
    [string]$IconText = '■',
    [string]$IconFill = '2F5EA5'
  )

  $card = Add-PptRect -Slide $Slide -Left $Left -Top $Top -Width $Width -Height $Height -FillColor $FillColor -LineColor $FillColor -Rounded
  $card.Line.Weight = 1.2

  Add-PptPill -Slide $Slide -Left ($Left + $Width - 54) -Top ($Top + 12) -Width 42 -Height 28 -Text $IconText -FillColor $IconFill -FontColor 'FFFFFF' -FontSize 14
  Add-PptShapeTextBox -Slide $Slide -Left ($Left + 18) -Top ($Top + 14) -Width ($Width - 80) -Height 20 -Text $Label -FontSize 9 -FontColor 'D9E6F7' -Bold -FontName 'Bahnschrift SemiBold' | Out-Null
  Add-PptShapeTextBox -Slide $Slide -Left ($Left + 18) -Top ($Top + 40) -Width ($Width - 36) -Height 36 -Text $Value -FontSize 24 -FontColor $ValueColor -Bold -FontName 'Playfair Display' | Out-Null
  if ($MiniText) {
    Add-PptShapeTextBox -Slide $Slide -Left ($Left + 18) -Top ($Top + 74) -Width ($Width - 36) -Height 20 -Text $MiniText -FontSize 9 -FontColor 'D9E6F7' -FontName 'Bahnschrift SemiBold' | Out-Null
  }

  return $card
}

function Add-UiTableFrame {
  param(
    [object]$Slide,
    [double]$Left,
    [double]$Top,
    [double]$Width,
    [double]$Height,
    [string[]]$Headers,
    [double[]]$ColumnWidths,
    [string[]]$RowValues = @(),
    [string]$EmptyText = ''
  )

  $frame = Add-PptRect -Slide $Slide -Left $Left -Top $Top -Width $Width -Height $Height -FillColor 'FFFFFF' -LineColor 'D0DCEE' -Rounded
  $headerHeight = 34
  $header = Add-PptRect -Slide $Slide -Left $Left -Top $Top -Width $Width -Height $headerHeight -FillColor 'EDF3FB' -LineColor 'D0DCEE' -Rounded
  $header.Line.Weight = 1
  $cursor = $Left + 10
  for ($i = 0; $i -lt $Headers.Count; $i++) {
    $colWidth = if ($i -lt $ColumnWidths.Count) { $ColumnWidths[$i] } else { 100 }
    Add-PptShapeTextBox -Slide $Slide -Left $cursor -Top ($Top + 6) -Width $colWidth -Height 18 -Text $Headers[$i] -FontSize 9 -FontColor '1F3D7A' -Bold -FontName 'Bahnschrift SemiBold' | Out-Null
    $cursor += $colWidth
  }

  if ($RowValues.Count -gt 0) {
    $rowTop = $Top + $headerHeight + 2
    $rowHeight = [Math]::Max(42, $Height - $headerHeight - 2)
    Add-PptRect -Slide $Slide -Left $Left -Top $rowTop -Width $Width -Height $rowHeight -FillColor 'F7FAFD' -LineColor 'D0DCEE' | Out-Null
    $cursor = $Left + 10
    for ($i = 0; $i -lt $RowValues.Count; $i++) {
      $colWidth = if ($i -lt $ColumnWidths.Count) { $ColumnWidths[$i] } else { 100 }
      Add-PptShapeTextBox -Slide $Slide -Left $cursor -Top ($rowTop + 10) -Width $colWidth -Height 18 -Text $RowValues[$i] -FontSize 9 -FontColor '2E3A4A' -FontName 'Calibri' | Out-Null
      $cursor += $colWidth
    }
  } elseif ($EmptyText) {
    Add-PptShapeTextBox -Slide $Slide -Left ($Left + 10) -Top ($Top + 48) -Width ($Width - 20) -Height 22 -Text $EmptyText -FontSize 10 -FontColor '4F5D73' -Align 'center' -FontName 'Calibri' | Out-Null
  }

  return $frame
}

function Add-UiCommonChrome {
  param(
    [object]$Slide,
    [string]$BadgeText,
    [string]$HeroTitle,
    [string]$HeroSubtitle = 'CCTV / Security / IT Ops',
    [string]$HeroNote = ''
  )

  Set-SlideBackground -Slide $Slide -Color 'DCE7F7'
  Add-PptRect -Slide $Slide -Left 0 -Top 0 -Width 960 -Height 72 -FillColor '163A73' | Out-Null
  Add-PptPill -Slide $Slide -Left 20 -Top 17 -Width 52 -Height 44 -Text '☰' -FillColor '274E8A' -FontColor 'FFFFFF' -FontSize 18
  Add-PptPill -Slide $Slide -Left 56 -Top 10 -Width 298 -Height 54 -Text '' -FillColor '2A4D86' -LineColor '5D79AA'
  Add-PptImage -Slide $Slide -Path (Join-Path $repoRoot 'public/assets/img/kvsk-logo.jpg') -Left 62 -Top 14 -Width 46 -Height 46 | Out-Null
  Add-PptShapeTextBox -Slide $Slide -Left 122 -Top 22 -Width 214 -Height 20 -Text 'KVSK CCTV & IT SOLUTION' -FontSize 16 -FontColor 'FFFFFF' -Bold -FontName 'Bahnschrift SemiBold' | Out-Null
  Add-PptShapeTextBox -Slide $Slide -Left 122 -Top 42 -Width 234 -Height 14 -Text $BadgeText -FontSize 9 -FontColor '9FB5DA' -FontName 'Bahnschrift SemiBold' | Out-Null
  Add-PptPill -Slide $Slide -Left 760 -Top 18 -Width 126 -Height 40 -Text $BadgeText -FillColor 'D9E6F7' -FontColor '1F4E79' -FontSize 12 -Bold
  Add-PptPill -Slide $Slide -Left 899 -Top 18 -Width 40 -Height 40 -Text '🔔' -FillColor '274E8A' -FontColor 'FFFFFF' -FontSize 14
  Add-PptPill -Slide $Slide -Left 866 -Top 18 -Width 40 -Height 40 -Text '⏻' -FillColor 'F8EAEA' -FontColor '9E2B2B' -FontSize 14

  Add-PptRect -Slide $Slide -Left 76 -Top 110 -Width 808 -Height 92 -FillColor 'EAF1FB' -LineColor 'C4D4EA' -Rounded | Out-Null
  Add-PptShapeTextBox -Slide $Slide -Left 98 -Top 126 -Width 520 -Height 48 -Text $HeroTitle -FontSize 32 -FontColor '1F4E79' -Bold -FontName 'Bahnschrift SemiBold' | Out-Null
  Add-PptShapeTextBox -Slide $Slide -Left 742 -Top 126 -Width 116 -Height 18 -Text $HeroSubtitle -FontSize 11 -FontColor '2A5AA5' -FontName 'Bahnschrift SemiBold' -Align 'center' | Out-Null
  if ($HeroNote) {
    Add-PptShapeTextBox -Slide $Slide -Left 98 -Top 168 -Width 620 -Height 30 -Text $HeroNote -FontSize 10 -FontColor '5C718D' -FontName 'Calibri' | Out-Null
  }
}

function Get-UiScreenshotSpecs {
  return @(
    @{ Key = 'dashboard'; Title = 'Dashboard'; FileName = '01-dashboard.png'; Badge = 'ADMINISTRATOR'; },
    @{ Key = 'projects'; Title = 'Projects'; FileName = '02-projects.png'; Badge = 'PROJECTS'; },
    @{ Key = 'ongoing'; Title = 'Ongoing Projects'; FileName = '03-ongoing-projects.png'; Badge = 'ONGOING'; },
    @{ Key = 'transactions'; Title = 'Project Transactions'; FileName = '04-project-transactions.png'; Badge = 'TRANSACTIONS'; },
    @{ Key = 'service-orders'; Title = 'Service Orders'; FileName = '05-service-orders.png'; Badge = 'SERVICE ORDERS'; },
    @{ Key = 'procurement'; Title = 'Procurement Management'; FileName = '06-procurement.png'; Badge = 'PROCUREMENT MODULE'; },
    @{ Key = 'ap'; Title = 'Accounts Payable Management'; FileName = '07-accounts-payable.png'; Badge = 'PAYABLES MODULE'; },
    @{ Key = 'ar'; Title = 'Accounts Receivable Management'; FileName = '08-accounts-receivable.png'; Badge = 'RECEIVABLES MODULE'; },
    @{ Key = 'reports'; Title = 'Reports'; FileName = '09-reports.png'; Badge = 'REPORTS MODULE'; },
    @{ Key = 'sidebar'; Title = 'Sidebar Menu'; FileName = '10-sidebar-open.png'; Badge = 'OPERATIONS CONTROL PANEL'; }
  )
}

function Add-UiMockupSlide {
  param(
    [object]$Presentation,
    [hashtable]$Spec
  )

  $slide = $Presentation.Slides.Add($Presentation.Slides.Count + 1, 12)
  $key = $Spec.Key

  switch ($key) {
    'dashboard' {
      Add-UiCommonChrome -Slide $slide -BadgeText $Spec.Badge -HeroTitle 'Dashboard' -HeroSubtitle 'CCTV / Security / IT Ops'
      Add-UiCard -Slide $slide -Left 76 -Top 214 -Width 190 -Height 130 -Label 'Projects' -Value '1' -MiniText 'All Companies • 1 Project' -FillColor '1F4E79' -IconText '■' -IconFill '5477B1' | Out-Null
      Add-UiCard -Slide $slide -Left 279 -Top 214 -Width 190 -Height 130 -Label 'Accounts Payable' -Value 'PHP 0.00' -MiniText 'All Companies • 0 Bills' -FillColor '8B1E1E' -IconText '■' -IconFill 'B44B4B' | Out-Null
      Add-UiCard -Slide $slide -Left 482 -Top 214 -Width 190 -Height 130 -Label 'A/R' -Value 'PHP 0.00' -MiniText 'All Companies • 0 Invoices' -FillColor '1E7AD6' -IconText '■' -IconFill '63A5EA' | Out-Null
      Add-UiCard -Slide $slide -Left 685 -Top 214 -Width 190 -Height 130 -Label 'Reports' -Value 'LIVE' -MiniText 'Collections Overview & Analytics' -FillColor '1D6D86' -IconText '■' -IconFill '4CA5BD' | Out-Null
    }
    'projects' {
      Add-UiCommonChrome -Slide $slide -BadgeText 'PROJECTS' -HeroTitle 'PROJECTS' -HeroSubtitle 'CCTV / Security / IT Ops'
      Add-PptRect -Slide $slide -Left 76 -Top 214 -Width 808 -Height 270 -FillColor 'F4F8FD' -LineColor 'D0DCEE' -Rounded | Out-Null
      Add-PptPill -Slide $slide -Left 96 -Top 240 -Width 176 -Height 40 -Text 'BACK TO DASHBOARD' -FillColor 'FFFFFF' -FontColor '2E3A4A' -FontSize 12 -Bold
      Add-PptPill -Slide $slide -Left 642 -Top 240 -Width 170 -Height 40 -Text 'Search project title, number, or company...' -FillColor 'FFFFFF' -FontColor '7A7A7A' -FontSize 10 -Bold:$false
      Add-PptPill -Slide $slide -Left 818 -Top 240 -Width 50 -Height 40 -Text '+' -FillColor 'E7F0FB' -FontColor '1F4E79' -FontSize 16 -Bold
      Add-PptShapeTextBox -Slide $slide -Left 90 -Top 292 -Width 170 -Height 16 -Text 'PROJECT OPERATIONS' -FontSize 9 -FontColor '5D79AA' -FontName 'Bahnschrift SemiBold' | Out-Null
      $cardY = 320
      Add-UiCard -Slide $slide -Left 86 -Top $cardY -Width 148 -Height 108 -Label 'TOTAL PROJECTS' -Value '1' -FillColor '1F4E79' -IconText '■' -IconFill '5477B1' | Out-Null
      Add-UiCard -Slide $slide -Left 246 -Top $cardY -Width 148 -Height 108 -Label 'ONGOING' -Value '1' -FillColor '1D6D86' -IconText '▲' -IconFill '4CA5BD' | Out-Null
      Add-UiCard -Slide $slide -Left 406 -Top $cardY -Width 148 -Height 108 -Label 'TRANSACTIONS' -Value '0' -FillColor '7A1F1F' -IconText '■' -IconFill 'A64A4A' | Out-Null
      Add-UiCard -Slide $slide -Left 566 -Top $cardY -Width 148 -Height 108 -Label 'PURCHASE ORDERS' -Value '0' -FillColor '1E7AD6' -IconText '■' -IconFill '63A5EA' | Out-Null
      Add-UiCard -Slide $slide -Left 726 -Top $cardY -Width 148 -Height 108 -Label 'SERVICE ORDERS' -Value '0' -FillColor '1D6D86' -IconText '✦' -IconFill '4CA5BD' | Out-Null
      Add-UiTableFrame -Slide $slide -Left 86 -Top 433 -Width 788 -Height 78 -Headers @('PROJECT NO.','PROJECT TITLE','COMPANY','START DATE','END DATE','ACTIONS') -ColumnWidths @(114,148,244,100,100,70) -RowValues @('PRJ-2026-05-01','Apollo CCTV','Apollo Lens Manufacturing Philippines Inc','2026-05-03','2026-06-02','EDIT / ADD TRANSACTION') | Out-Null
    }
    'ongoing' {
      Add-UiCommonChrome -Slide $slide -BadgeText 'PROJECTS' -HeroTitle 'ONGOING PROJECTS' -HeroSubtitle 'CCTV / Security / IT Ops'
      Add-PptRect -Slide $slide -Left 76 -Top 214 -Width 808 -Height 244 -FillColor 'F4F8FD' -LineColor 'D0DCEE' -Rounded | Out-Null
      Add-PptShapeTextBox -Slide $slide -Left 90 -Top 242 -Width 170 -Height 16 -Text 'ONGOING PROJECTS' -FontSize 9 -FontColor '5D79AA' -FontName 'Bahnschrift SemiBold' | Out-Null
      Add-PptPill -Slide $slide -Left 94 -Top 276 -Width 176 -Height 40 -Text 'BACK TO DASHBOARD' -FillColor 'FFFFFF' -FontColor '2E3A4A' -FontSize 12 -Bold
      Add-PptPill -Slide $slide -Left 658 -Top 276 -Width 140 -Height 40 -Text 'Search project, manager, members...' -FillColor 'FFFFFF' -FontColor '7A7A7A' -FontSize 10 -Bold:$false
      Add-PptPill -Slide $slide -Left 806 -Top 276 -Width 62 -Height 40 -Text 'Ongoing' -FillColor 'FFFFFF' -FontColor '1F4E79' -FontSize 12 -Bold
      Add-UiTableFrame -Slide $slide -Left 86 -Top 332 -Width 788 -Height 108 -Headers @('PROJECT NAME','MANAGER','MEMBERS','START DATE','END DATE','PROGRESS','STATUS','BUDGET') -ColumnWidths @(150,110,90,100,100,90,80,80) -RowValues @('Apollo CCTV','-','-','2026-05-03','2026-06-02','0%','ONGOING','PHP 0.00') | Out-Null
    }
    'transactions' {
      Add-UiCommonChrome -Slide $slide -BadgeText 'TRANSACTIONS' -HeroTitle 'PROJECT TRANSACTIONS' -HeroSubtitle 'CCTV / Security / IT Ops'
      Add-PptRect -Slide $slide -Left 76 -Top 214 -Width 808 -Height 286 -FillColor 'F4F8FD' -LineColor 'D0DCEE' -Rounded | Out-Null
      Add-PptPill -Slide $slide -Left 94 -Top 240 -Width 176 -Height 40 -Text 'BACK TO DASHBOARD' -FillColor 'FFFFFF' -FontColor '2E3A4A' -FontSize 12 -Bold
      Add-PptPill -Slide $slide -Left 462 -Top 240 -Width 180 -Height 40 -Text 'Search client, document number...' -FillColor 'FFFFFF' -FontColor '7A7A7A' -FontSize 10 -Bold:$false
      Add-PptPill -Slide $slide -Left 648 -Top 240 -Width 110 -Height 40 -Text 'All Status' -FillColor 'FFFFFF' -FontColor '1F4E79' -FontSize 12 -Bold
      Add-PptPill -Slide $slide -Left 766 -Top 240 -Width 108 -Height 40 -Text 'Select Company' -FillColor 'FFFFFF' -FontColor '1F4E79' -FontSize 10 -Bold:$false
      Add-PptPill -Slide $slide -Left 874 -Top 240 -Width 70 -Height 40 -Text 'ADD' -FillColor 'E7F0FB' -FontColor '1F4E79' -FontSize 12 -Bold
      Add-UiCard -Slide $slide -Left 86 -Top 300 -Width 198 -Height 118 -Label 'TOTAL RECORDS' -Value '0' -FillColor '1F4E79' -IconText '■' -IconFill '5477B1' | Out-Null
      Add-UiCard -Slide $slide -Left 294 -Top 300 -Width 198 -Height 118 -Label 'PAID' -Value '0' -FillColor '1D6D86' -IconText '▲' -IconFill '4CA5BD' | Out-Null
      Add-UiCard -Slide $slide -Left 502 -Top 300 -Width 198 -Height 118 -Label 'PARTIAL' -Value '0' -FillColor '1E7AD6' -IconText '◔' -IconFill '63A5EA' | Out-Null
      Add-UiCard -Slide $slide -Left 710 -Top 300 -Width 198 -Height 118 -Label 'UNPAID' -Value '0' -FillColor '7A1F1F' -IconText '◔' -IconFill 'A64A4A' | Out-Null
      Add-UiTableFrame -Slide $slide -Left 86 -Top 426 -Width 822 -Height 76 -Headers @('DOC NO.','TYPE','CLIENT','PROJECT','DESCRIPTION','AMOUNT','BALANCE','STATUS') -ColumnWidths @(110,90,140,140,150,70,70,52) -EmptyText 'Walang records na nahanap.' | Out-Null
    }
    'service-orders' {
      Add-UiCommonChrome -Slide $slide -BadgeText 'SERVICE ORDERS' -HeroTitle 'SERVICE ORDERS' -HeroSubtitle 'CCTV / Security / IT Ops'
      Add-PptShapeTextBox -Slide $slide -Left 90 -Top 196 -Width 420 -Height 18 -Text 'Service orders are linked to projects and transactions for operational tracking.' -FontSize 10 -FontColor '5C718D' -FontName 'Calibri' | Out-Null
      Add-PptRect -Slide $slide -Left 76 -Top 214 -Width 808 -Height 286 -FillColor 'F4F8FD' -LineColor 'D0DCEE' -Rounded | Out-Null
      Add-PptPill -Slide $slide -Left 94 -Top 240 -Width 176 -Height 40 -Text 'BACK TO PROJECT OPERATIONS' -FillColor 'FFFFFF' -FontColor '2E3A4A' -FontSize 12 -Bold
      Add-PptPill -Slide $slide -Left 662 -Top 240 -Width 176 -Height 40 -Text 'Search SO, transaction...' -FillColor 'FFFFFF' -FontColor '7A7A7A' -FontSize 10 -Bold:$false
      Add-PptPill -Slide $slide -Left 846 -Top 240 -Width 98 -Height 40 -Text 'ADD SO' -FillColor 'E7F0FB' -FontColor '1F4E79' -FontSize 12 -Bold
      Add-UiCard -Slide $slide -Left 86 -Top 300 -Width 150 -Height 118 -Label 'TOTAL SO' -Value '0' -FillColor '1F4E79' -IconText '■' -IconFill '5477B1' | Out-Null
      Add-UiCard -Slide $slide -Left 246 -Top 300 -Width 150 -Height 118 -Label 'WITH TXN' -Value '0' -FillColor '1D6D86' -IconText '■' -IconFill '4CA5BD' | Out-Null
      Add-UiCard -Slide $slide -Left 406 -Top 300 -Width 150 -Height 118 -Label 'NO TXN' -Value '0' -FillColor '1E7AD6' -IconText '■' -IconFill '63A5EA' | Out-Null
      Add-UiCard -Slide $slide -Left 566 -Top 300 -Width 238 -Height 118 -Label 'TOTAL AMOUNT' -Value 'PHP 0.00' -FillColor '1D6D86' -IconText '■' -IconFill '4CA5BD' | Out-Null
      Add-UiTableFrame -Slide $slide -Left 86 -Top 426 -Width 822 -Height 76 -Headers @('SO NO.','VENDOR','BILL TO','PROJECT','TRANSACTION','SERVICE TITLE','TYPE','DATE','AMOUNT','NOTES','STATUS','ACTIONS') -ColumnWidths @(80,90,120,100,92,100,70,58,70,66,52,54) -EmptyText 'No service orders found.' | Out-Null
    }
    'procurement' {
      Add-UiCommonChrome -Slide $slide -BadgeText 'PROCUREMENT MODULE' -HeroTitle 'PROCUREMENT MANAGEMENT' -HeroSubtitle 'CCTV / Security / IT Ops'
      Add-PptShapeTextBox -Slide $slide -Left 90 -Top 196 -Width 420 -Height 18 -Text 'Handle requisitions, purchase orders, and goods receipts in one clean flow.' -FontSize 10 -FontColor '5C718D' -FontName 'Calibri' | Out-Null
      Add-PptRect -Slide $slide -Left 76 -Top 214 -Width 808 -Height 262 -FillColor 'F4F8FD' -LineColor 'D0DCEE' -Rounded | Out-Null
      Add-PptPill -Slide $slide -Left 94 -Top 240 -Width 176 -Height 40 -Text 'BACK TO DASHBOARD' -FillColor 'FFFFFF' -FontColor '2E3A4A' -FontSize 12 -Bold
      Add-PptPill -Slide $slide -Left 682 -Top 240 -Width 186 -Height 40 -Text 'Search vendor name, contact...' -FillColor 'FFFFFF' -FontColor '7A7A7A' -FontSize 10 -Bold:$false
      Add-PptPill -Slide $slide -Left 876 -Top 240 -Width 80 -Height 40 -Text 'ADD' -FillColor 'E7F0FB' -FontColor '1F4E79' -FontSize 12 -Bold
      Add-UiCard -Slide $slide -Left 86 -Top 298 -Width 158 -Height 108 -Label 'REQUISITIONS' -Value '0' -FillColor 'F4F7FB' -ValueColor '22344F' -IconText '■' -IconFill 'A7BDD8' | Out-Null
      Add-UiCard -Slide $slide -Left 254 -Top 298 -Width 158 -Height 108 -Label 'PURCHASE ORDERS' -Value '0' -FillColor 'F4F7FB' -ValueColor '22344F' -IconText '■' -IconFill 'A7BDD8' | Out-Null
      Add-UiCard -Slide $slide -Left 422 -Top 298 -Width 158 -Height 108 -Label 'GOODS RECEIPTS' -Value '0' -FillColor 'F4F7FB' -ValueColor '22344F' -IconText '■' -IconFill 'A7BDD8' | Out-Null
      Add-UiCard -Slide $slide -Left 590 -Top 298 -Width 294 -Height 108 -Label 'TOTAL COMMITMENTS' -Value 'PHP 0.00' -FillColor 'F4F7FB' -ValueColor '22344F' -IconText '■' -IconFill 'A7BDD8' | Out-Null
      Add-PptPill -Slide $slide -Left 74 -Top 424 -Width 158 -Height 40 -Text 'REQUISITIONS' -FillColor 'FFFDF8' -FontColor '5C718D' -FontSize 11 -Bold:$false
      Add-PptPill -Slide $slide -Left 182 -Top 424 -Width 98 -Height 40 -Text 'VENDORS' -FillColor 'E7F0FB' -FontColor '1F4E79' -FontSize 11 -Bold
      Add-PptPill -Slide $slide -Left 294 -Top 424 -Width 140 -Height 40 -Text 'PURCHASE ORDERS' -FillColor 'FFFDF8' -FontColor '5C718D' -FontSize 11 -Bold:$false
      Add-PptPill -Slide $slide -Left 448 -Top 424 -Width 118 -Height 40 -Text 'GOODS RECEIPTS' -FillColor 'FFFDF8' -FontColor '5C718D' -FontSize 11 -Bold:$false
      Add-PptRect -Slide $slide -Left 76 -Top 472 -Width 808 -Height 46 -FillColor 'EAF1FB' -LineColor 'D0DCEE' -Rounded | Out-Null
      Add-PptShapeTextBox -Slide $slide -Left 94 -Top 485 -Width 170 -Height 18 -Text 'VENDOR DIRECTORY' -FontSize 16 -FontColor '1F4E79' -Bold -FontName 'Playfair Display' | Out-Null
      Add-UiTableFrame -Slide $slide -Left 76 -Top 504 -Width 808 -Height 64 -Headers @('VENDOR','CONTACT PERSON','EMAIL','PHONE','TIN','ACTIONS') -ColumnWidths @(120,150,160,130,120,90) -RowValues @('r','r','r@gmail.com','568765234324','435-675-434-232','USE IN PO') | Out-Null
    }
    'ap' {
      Add-UiCommonChrome -Slide $slide -BadgeText 'PAYABLES MODULE' -HeroTitle 'ACCOUNTS PAYABLE MANAGEMENT' -HeroSubtitle 'CCTV / Security / IT Ops'
      Add-PptShapeTextBox -Slide $slide -Left 90 -Top 196 -Width 360 -Height 18 -Text 'Manage bills, payments, and due balances in one workspace.' -FontSize 10 -FontColor '5C718D' -FontName 'Calibri' | Out-Null
      Add-PptRect -Slide $slide -Left 36 -Top 214 -Width 888 -Height 270 -FillColor 'F4F8FD' -LineColor 'D0DCEE' -Rounded | Out-Null
      Add-PptPill -Slide $slide -Left 44 -Top 242 -Width 176 -Height 40 -Text 'BACK TO DASHBOARD' -FillColor 'FFFFFF' -FontColor '2E3A4A' -FontSize 12 -Bold
      Add-PptPill -Slide $slide -Left 670 -Top 242 -Width 176 -Height 40 -Text 'Search bill number, vendor...' -FillColor 'FFFFFF' -FontColor '7A7A7A' -FontSize 10 -Bold:$false
      Add-PptPill -Slide $slide -Left 854 -Top 242 -Width 80 -Height 40 -Text 'NEW' -FillColor 'E7F0FB' -FontColor '1F4E79' -FontSize 12 -Bold
      Add-UiCard -Slide $slide -Left 44 -Top 302 -Width 186 -Height 112 -Label 'ACTIVE VENDORS' -Value '1' -FillColor 'F4F7FB' -ValueColor '22344F' -IconText '■' -IconFill 'A7BDD8' | Out-Null
      Add-UiCard -Slide $slide -Left 242 -Top 302 -Width 186 -Height 112 -Label 'OPEN BILLS' -Value '0' -FillColor 'F4F7FB' -ValueColor '22344F' -IconText '■' -IconFill 'A7BDD8' | Out-Null
      Add-UiCard -Slide $slide -Left 440 -Top 302 -Width 186 -Height 112 -Label 'TOTAL PAYABLE' -Value 'PHP 0.00' -FillColor 'F4F7FB' -ValueColor '22344F' -IconText '■' -IconFill 'A7BDD8' | Out-Null
      Add-UiCard -Slide $slide -Left 638 -Top 302 -Width 186 -Height 112 -Label 'OVERDUE AMOUNT' -Value 'PHP 0.00' -FillColor 'F4F7FB' -ValueColor '22344F' -IconText '■' -IconFill 'A7BDD8' | Out-Null
      Add-PptPill -Slide $slide -Left 38 -Top 430 -Width 72 -Height 40 -Text 'BILLS' -FillColor 'E7F0FB' -FontColor '1F4E79' -FontSize 11 -Bold
      Add-PptPill -Slide $slide -Left 118 -Top 430 -Width 100 -Height 40 -Text 'PAYMENTS' -FillColor 'FFFDF8' -FontColor '5C718D' -FontSize 11 -Bold:$false
      Add-PptRect -Slide $slide -Left 36 -Top 478 -Width 888 -Height 48 -FillColor 'EAF1FB' -LineColor 'D0DCEE' -Rounded | Out-Null
      Add-PptShapeTextBox -Slide $slide -Left 54 -Top 491 -Width 160 -Height 18 -Text 'BILLS REGISTER' -FontSize 16 -FontColor '1F4E79' -Bold -FontName 'Playfair Display' | Out-Null
      Add-UiTableFrame -Slide $slide -Left 36 -Top 520 -Width 888 -Height 64 -Headers @('BILL NUMBER','VENDOR','BILL DATE','DUE DATE','TOTAL AMOUNT','PAID AMOUNT','BALANCE','STATUS','ACTIONS') -ColumnWidths @(110,96,88,88,105,100,90,54,65) -EmptyText 'No bills found' | Out-Null
    }
    'ar' {
      Add-UiCommonChrome -Slide $slide -BadgeText 'RECEIVABLES MODULE' -HeroTitle 'ACCOUNTS RECEIVABLE MANAGEMENT' -HeroSubtitle 'CCTV / Security / IT Ops'
      Add-PptShapeTextBox -Slide $slide -Left 90 -Top 196 -Width 360 -Height 18 -Text 'Track unpaid invoices, partial payments, and overdue balances.' -FontSize 10 -FontColor '5C718D' -FontName 'Calibri' | Out-Null
      Add-PptRect -Slide $slide -Left 36 -Top 214 -Width 888 -Height 270 -FillColor 'F4F8FD' -LineColor 'D0DCEE' -Rounded | Out-Null
      Add-PptPill -Slide $slide -Left 44 -Top 242 -Width 176 -Height 40 -Text 'BACK TO DASHBOARD' -FillColor 'FFFFFF' -FontColor '2E3A4A' -FontSize 12 -Bold
      Add-PptPill -Slide $slide -Left 670 -Top 242 -Width 176 -Height 40 -Text 'Search customer or invoice no...' -FillColor 'FFFFFF' -FontColor '7A7A7A' -FontSize 10 -Bold:$false
      Add-PptPill -Slide $slide -Left 854 -Top 242 -Width 80 -Height 40 -Text 'ADD' -FillColor 'E7F0FB' -FontColor '1F4E79' -FontSize 12 -Bold
      Add-UiCard -Slide $slide -Left 44 -Top 302 -Width 150 -Height 112 -Label 'OUTSTANDING' -Value 'PHP 0.00' -FillColor 'F4F7FB' -ValueColor '22344F' -IconText '■' -IconFill 'A7BDD8' | Out-Null
      Add-UiCard -Slide $slide -Left 204 -Top 302 -Width 150 -Height 112 -Label 'OPEN ACCOUNTS' -Value '0' -FillColor 'F4F7FB' -ValueColor '22344F' -IconText '■' -IconFill 'A7BDD8' | Out-Null
      Add-UiCard -Slide $slide -Left 364 -Top 302 -Width 150 -Height 112 -Label 'OVERDUE AMOUNT' -Value 'PHP 0.00' -FillColor 'F4F7FB' -ValueColor '22344F' -IconText '■' -IconFill 'A7BDD8' | Out-Null
      Add-UiCard -Slide $slide -Left 524 -Top 302 -Width 150 -Height 112 -Label 'DRAFT + SENT' -Value '0' -FillColor 'F4F7FB' -ValueColor '22344F' -IconText '■' -IconFill 'A7BDD8' | Out-Null
      Add-UiCard -Slide $slide -Left 684 -Top 302 -Width 150 -Height 112 -Label 'PARTIAL' -Value '0' -FillColor 'F4F7FB' -ValueColor '22344F' -IconText '■' -IconFill 'A7BDD8' | Out-Null
      Add-UiCard -Slide $slide -Left 844 -Top 302 -Width 104 -Height 112 -Label 'PAID' -Value '0' -FillColor 'F4F7FB' -ValueColor '22344F' -IconText '■' -IconFill 'A7BDD8' | Out-Null
      Add-PptPill -Slide $slide -Left 38 -Top 430 -Width 116 -Height 40 -Text 'RECEIVABLES' -FillColor 'E7F0FB' -FontColor '1F4E79' -FontSize 11 -Bold
      Add-PptPill -Slide $slide -Left 160 -Top 430 -Width 100 -Height 40 -Text 'PAYMENTS' -FillColor 'FFFDF8' -FontColor '5C718D' -FontSize 11 -Bold:$false
      Add-PptRect -Slide $slide -Left 36 -Top 478 -Width 888 -Height 48 -FillColor 'EAF1FB' -LineColor 'D0DCEE' -Rounded | Out-Null
      Add-PptShapeTextBox -Slide $slide -Left 54 -Top 491 -Width 180 -Height 18 -Text 'RECEIVABLES REGISTER' -FontSize 16 -FontColor '1F4E79' -Bold -FontName 'Playfair Display' | Out-Null
      Add-UiTableFrame -Slide $slide -Left 36 -Top 520 -Width 888 -Height 64 -Headers @('INVOICE NO.','CUSTOMER','SOURCE TRANSACTION','INVOICE DATE','DUE DATE','TOTAL AMOUNT','PAID AMOUNT','BALANCE','STATUS','ACTIONS') -ColumnWidths @(92,100,140,90,84,102,95,85,54,52) -EmptyText 'No receivables found' | Out-Null
    }
    'reports' {
      Add-UiCommonChrome -Slide $slide -BadgeText 'REPORTS' -HeroTitle 'REPORTS' -HeroSubtitle 'CCTV / Security / IT Ops' -HeroNote 'Collections overview, invoice status, financial summaries, and project analytics across all companies.'
      Add-PptRect -Slide $slide -Left 76 -Top 214 -Width 808 -Height 56 -FillColor 'F4F8FD' -LineColor 'D0DCEE' -Rounded | Out-Null
      Add-PptPill -Slide $slide -Left 92 -Top 228 -Width 176 -Height 32 -Text 'BACK TO DASHBOARD' -FillColor 'FFFFFF' -FontColor '2E3A4A' -FontSize 11 -Bold
      Add-PptPill -Slide $slide -Left 618 -Top 228 -Width 176 -Height 32 -Text 'Search company name...' -FillColor 'FFFFFF' -FontColor '7A7A7A' -FontSize 10 -Bold:$false
      Add-PptRect -Slide $slide -Left 76 -Top 286 -Width 506 -Height 230 -FillColor 'F4F8FD' -LineColor 'D0DCEE' -Rounded | Out-Null
      Add-PptShapeTextBox -Slide $slide -Left 94 -Top 306 -Width 240 -Height 18 -Text 'COLLECTIONS OVERVIEW' -FontSize 16 -FontColor '1F4E79' -Bold -FontName 'Playfair Display' | Out-Null
      Add-PptPill -Slide $slide -Left 468 -Top 300 -Width 86 -Height 28 -Text '6 MONTHS' -FillColor 'E7F0FB' -FontColor '1F4E79' -FontSize 11 -Bold
      Add-PptPill -Slide $slide -Left 558 -Top 300 -Width 76 -Height 28 -Text '1 YEAR' -FillColor 'FFFFFF' -FontColor '4F5D73' -FontSize 11 -Bold:$false
      Add-PptRect -Slide $slide -Left 96 -Top 350 -Width 460 -Height 120 -FillColor 'FFFFFF' -LineColor 'D0DCEE' -Rounded | Out-Null
      Add-PptRect -Slide $slide -Left 96 -Top 350 -Width 460 -Height 120 -FillColor 'FFFFFF' -LineColor 'FFFFFF' | Out-Null
      Add-PptRect -Slide $slide -Left 96 -Top 350 -Width 460 -Height 120 -FillColor 'FFFFFF' -LineColor 'FFFFFF' | Out-Null
      Add-PptRect -Slide $slide -Left 96 -Top 350 -Width 460 -Height 120 -FillColor 'FFFFFF' -LineColor 'D0DCEE' -Rounded | Out-Null
      Add-PptShapeTextBox -Slide $slide -Left 112 -Top 398 -Width 420 -Height 16 -Text 'PHP 0  ▏  PHP 0  ▏  PHP 0  ▏  PHP 0' -FontSize 9 -FontColor '61738F' -FontName 'Calibri' | Out-Null
      Add-PptRect -Slide $slide -Left 520 -Top 286 -Width 284 -Height 230 -FillColor 'F4F8FD' -LineColor 'D0DCEE' -Rounded | Out-Null
      Add-PptShapeTextBox -Slide $slide -Left 540 -Top 306 -Width 220 -Height 18 -Text 'INVOICE STATUS' -FontSize 16 -FontColor '1F4E79' -Bold -FontName 'Playfair Display' | Out-Null
      Add-PptRect -Slide $slide -Left 596 -Top 358 -Width 124 -Height 124 -FillColor 'FFFFFF' -LineColor 'D0DCEE' -Rounded | Out-Null
      Add-PptRect -Slide $slide -Left 618 -Top 380 -Width 80 -Height 80 -FillColor 'F8F3EA' -LineColor 'D9D2C2' -Rounded | Out-Null
      Add-PptShapeTextBox -Slide $slide -Left 630 -Top 404 -Width 56 -Height 20 -Text '0' -FontSize 24 -FontColor '1F4E79' -Bold -Align 'center' -FontName 'Playfair Display' | Out-Null
      Add-PptShapeTextBox -Slide $slide -Left 622 -Top 430 -Width 72 -Height 16 -Text 'INVOICES' -FontSize 10 -FontColor '6A7B94' -Align 'center' -FontName 'Bahnschrift SemiBold' | Out-Null
      Add-PptShapeTextBox -Slide $slide -Left 586 -Top 492 -Width 160 -Height 16 -Text 'No invoice data yet' -FontSize 10 -FontColor '1F4E79' -FontName 'Calibri' | Out-Null
      Add-PptPill -Slide $slide -Left 540 -Top 520 -Width 102 -Height 34 -Text 'PAID' -FillColor 'FFFFFF' -FontColor '1F4E79' -FontSize 10 -Bold:$false
      Add-PptPill -Slide $slide -Left 652 -Top 520 -Width 102 -Height 34 -Text 'PARTIAL' -FillColor 'FFFFFF' -FontColor '1F4E79' -FontSize 10 -Bold:$false
      Add-PptPill -Slide $slide -Left 764 -Top 520 -Width 102 -Height 34 -Text 'UNPAID' -FillColor 'FFFFFF' -FontColor '1F4E79' -FontSize 10 -Bold:$false
    }
    'sidebar' {
      Set-SlideBackground -Slide $slide -Color 'DCE7F7'
      Add-PptRect -Slide $slide -Left 0 -Top 0 -Width 960 -Height 540 -FillColor 'E6EEF9' | Out-Null
      Add-PptRect -Slide $slide -Left 0 -Top 0 -Width 960 -Height 540 -FillColor '163A73' | Out-Null
      Add-PptRect -Slide $slide -Left 0 -Top 0 -Width 960 -Height 540 -FillColor 'E7EEF8' | Out-Null
      Add-PptRect -Slide $slide -Left 0 -Top 0 -Width 202 -Height 540 -FillColor '183C75' | Out-Null
      Add-PptRect -Slide $slide -Left 0 -Top 0 -Width 202 -Height 90 -FillColor '40609A' | Out-Null
      Add-PptImage -Slide $slide -Path (Join-Path $repoRoot 'public/assets/img/kvsk-logo.jpg') -Left 12 -Top 14 -Width 46 -Height 46 | Out-Null
      Add-PptShapeTextBox -Slide $slide -Left 70 -Top 18 -Width 100 -Height 20 -Text 'KVSK CCTV' -FontSize 16 -FontColor 'FFFFFF' -Bold -FontName 'Bahnschrift SemiBold' | Out-Null
      Add-PptShapeTextBox -Slide $slide -Left 70 -Top 40 -Width 126 -Height 16 -Text 'OPERATIONS CONTROL PANEL' -FontSize 9 -FontColor '91A7D2' -FontName 'Bahnschrift SemiBold' | Out-Null
      Add-PptPill -Slide $slide -Left 160 -Top 22 -Width 26 -Height 26 -Text 'X' -FillColor '5A75A4' -FontColor 'FFFFFF' -FontSize 10 -Bold
      $menuY = 120
      foreach ($item in @('Dashboard','Reports','Company Registry')) {
        Add-PptShapeTextBox -Slide $slide -Left 26 -Top $menuY -Width 140 -Height 18 -Text $item -FontSize 14 -FontColor 'DDE8F8' -Bold -FontName 'Bahnschrift SemiBold' | Out-Null
        Add-PptRect -Slide $slide -Left 22 -Top ($menuY + 18) -Width 8 -Height 8 -FillColor '5E79AA' | Out-Null
        $menuY += 92
      }
      Add-PptPill -Slide $slide -Left 8 -Top 436 -Width 184 -Height 54 -Text 'PROJECTS' -FillColor '1F4E79' -FontColor 'FFFFFF' -FontSize 13 -Bold
      Add-PptPill -Slide $slide -Left 8 -Top 496 -Width 184 -Height 54 -Text 'FINANCE' -FillColor '1F4E79' -FontColor 'FFFFFF' -FontSize 13 -Bold
    }
  }

  return $slide
}

function Append-UiScreenshotsToDocx {
  param(
    [string]$Path,
    [string]$ScreenshotDir
  )

  $specs = Get-UiScreenshotSpecs
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0

  try {
    $doc = $word.Documents.Open($Path)
    $sel = $word.Selection
    $sel.EndKey(6) | Out-Null
    $sel.TypeParagraph()
    $sel.TypeParagraph()
    $sel.TypeText('UI Screenshots')
    $sel.Style = 'Heading 1'
    $sel.TypeParagraph()
    $sel.TypeText('The following figures show the main application screens and module layouts used in the system documentation.')
    $sel.TypeParagraph()
    $sel.TypeParagraph()

    foreach ($spec in $specs) {
      $imgPath = Join-Path $ScreenshotDir $spec.FileName
      if (-not (Test-Path $imgPath)) { continue }
      $sel.TypeText("Figure: $($spec.Title)")
      $sel.TypeParagraph()
      $pic = $sel.InlineShapes.AddPicture($imgPath, $false, $true)
      try {
        $pic.LockAspectRatio = -1
        $pic.Width = 468
      } catch {}
      $sel.TypeParagraph()
      $sel.TypeParagraph()
      $sel.TypeText(' ')
      $sel.TypeParagraph()
      $sel.InsertBreak(7) | Out-Null
    }

    $doc.Save()
    $doc.Close()
  } finally {
    if ($doc) {
      try { $doc.Close() } catch {}
      [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($doc)
    }
    if ($word) {
      try { $word.Quit() } catch {}
      [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($word)
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
  }
}

function Set-SlideBackground {
  param(
    [object]$Slide,
    [string]$Color
  )

  $Slide.FollowMasterBackground = 0
  $Slide.Background.Fill.Solid()
  $Slide.Background.Fill.ForeColor.RGB = (ConvertTo-RgbInt $Color)
}

function Add-TitleSlide {
  param(
    [object]$Presentation,
    [string]$Title,
    [string]$Subtitle,
    [string]$Tagline
  )

  $slide = $Presentation.Slides.Add($Presentation.Slides.Count + 1, 12)
  Set-SlideBackground -Slide $slide -Color '163A73'

  Add-PptShapeTextBox -Slide $slide -Left 56 -Top 130 -Width 860 -Height 70 -Text $Title -FontSize 34 -FontColor 'FFFFFF' -Bold -Align 'center' | Out-Null
  Add-PptShapeTextBox -Slide $slide -Left 110 -Top 214 -Width 760 -Height 38 -Text $Subtitle -FontSize 20 -FontColor 'D9E6F7' -Align 'center' | Out-Null
  Add-PptRect -Slide $slide -Left 140 -Top 268 -Width 680 -Height 6 -FillColor 'C7362F' | Out-Null
  Add-PptShapeTextBox -Slide $slide -Left 150 -Top 304 -Width 660 -Height 46 -Text $Tagline -FontSize 16 -FontColor 'FFFFFF' -Align 'center' | Out-Null

  $badge = Add-PptRect -Slide $slide -Left 355 -Top 372 -Width 250 -Height 44 -FillColor 'FFFFFF' -LineColor 'D9E6F7' -Rounded
  $badge.TextFrame.TextRange.Text = 'Internal Documentation'
  $badge.TextFrame.TextRange.Font.Name = 'Calibri'
  $badge.TextFrame.TextRange.Font.Size = 15
  $badge.TextFrame.TextRange.Font.Bold = -1
  $badge.TextFrame.TextRange.Font.Color.RGB = (ConvertTo-RgbInt '163A73')
  $badge.TextFrame.TextRange.ParagraphFormat.Alignment = 2

  Add-PptShapeTextBox -Slide $slide -Left 54 -Top 468 -Width 290 -Height 22 -Text "Generated $generatedDateLong" -FontSize 11 -FontColor 'D9E6F7' -Align 'left' | Out-Null
}

function Add-ContentSlide {
  param(
    [object]$Presentation,
    [string]$Title,
    [string[]]$Bullets,
    [string]$SlideNumberLabel
  )

  $slide = $Presentation.Slides.Add($Presentation.Slides.Count + 1, 12)
  Set-SlideBackground -Slide $slide -Color 'EDF3FB'

  Add-PptRect -Slide $slide -Left 28 -Top 24 -Width 904 -Height 486 -FillColor 'FFFFFF' -LineColor 'D7E1F0' -Rounded | Out-Null
  Add-PptRect -Slide $slide -Left 28 -Top 24 -Width 904 -Height 54 -FillColor '1F4E79' -Rounded | Out-Null
  Add-PptShapeTextBox -Slide $slide -Left 52 -Top 35 -Width 650 -Height 28 -Text $Title -FontSize 22 -FontColor 'FFFFFF' -Bold | Out-Null
  Add-PptRect -Slide $slide -Left 52 -Top 90 -Width 78 -Height 5 -FillColor 'C7362F' | Out-Null

  $bodyText = ($Bullets | ForEach-Object { "- $_" }) -join "`r"
  Add-PptShapeTextBox -Slide $slide -Left 54 -Top 112 -Width 820 -Height 330 -Text $bodyText -FontSize 16 -FontColor '2E3A4A' | Out-Null
  Add-PptShapeTextBox -Slide $slide -Left 52 -Top 452 -Width 220 -Height 18 -Text $SlideNumberLabel -FontSize 10 -FontColor '6B7D95' | Out-Null

  return $slide
}

function New-SystemDocx {
  param(
    [string]$Path,
    [string]$Title,
    [string]$GeneratedDateLong,
    [string]$ScreenshotDir
  )

  $paragraphs = New-Object System.Collections.Generic.List[string]

  $paragraphs.Add((New-DocxParagraph -Text 'KVSK CCTV & IT Solution' -SizePt 30 -Color '1F4E79' -Bold -Align 'center' -Before 480 -After 120))
  $paragraphs.Add((New-DocxParagraph -Text 'ERP System Documentation' -SizePt 20 -Color 'C7362F' -Bold -Align 'center' -After 120))
  $paragraphs.Add((New-DocxParagraph -Text 'Project-centered operations, finance, procurement, and reporting' -SizePt 14 -Color '4F5D73' -Align 'center' -After 160))
  $paragraphs.Add((New-DocxParagraph -Text "Prepared for internal system documentation" -SizePt 11 -Color '4F5D73' -Align 'center' -After 60))
  $paragraphs.Add((New-DocxParagraph -Text "Generated on $GeneratedDateLong" -SizePt 11 -Color '4F5D73' -Align 'center' -After 0))
  $paragraphs.Add((New-DocxParagraph -PageBreak))

  $sections = @(
    @{
      Title = '1. System Overview'
      Bullets = @(
        'The system is a centralized ERP platform for KVSK CCTV & IT Solution.',
        'It is designed around project operations, with company records and vendors supporting the project workflow.',
        'The application tracks companies, projects, service orders, transactions, receivables, payables, procurement, user accounts, and system logs.',
        'The interface uses shared navigation, modals, search tools, and table views to keep the experience consistent across modules.'
      )
    },
    @{
      Title = '2. Technical Stack'
      Bullets = @(
        'Backend: Node.js with Express.',
        'Database: PostgreSQL.',
        'Frontend: HTML, CSS, and JavaScript.',
        'Shared assets provide the common sidebar, header, validation helpers, and search/filter behavior.',
        'PDF attachment support is used for project and transaction records.'
      )
    },
    @{
      Title = '3. Main Modules'
      Bullets = @(
        'Login and authentication.',
        'Dashboard and project operations.',
        'Company Registry.',
        'Procurement: Purchase Requisitions, Purchase Orders, and Goods Receipts.',
        'Accounts Payable and Accounts Receivable.',
        'Reports and analytics.',
        'User Management and system access control.'
      )
    },
    @{
      Title = '4. Core Workflow'
      Bullets = @(
        'Project-centered flow: Company Registry -> Projects -> Service Orders -> Transactions -> Accounts Receivable.',
        'Procurement flow: Purchase Requisition -> Purchase Order -> Goods Receipt.',
        'Payables flow: Vendor -> Bill -> Payment.',
        'The module links keep the project as the main reference point for tracking records.'
      )
    },
    @{
      Title = '5. Database Model'
      Bullets = @(
        'Major tables include company_registry, projects, service_orders, transactions, vendors, purchase_requisitions, purchase_orders, goods_receipts, accounts_payable, accounts_receivable, payments, users, and system_logs.',
        'Supporting tables cover chart_of_accounts, journal_entries, journal_lines, departments, employees, payroll_periods, payroll_runs, payroll_run_lines, project_costs, project_resources, and tasks.',
        'Relationships are used to keep projects, vendors, invoices, bills, and procurement records connected.'
      )
    },
    @{
      Title = '6. UI and Validation Rules'
      Bullets = @(
        'Shared sidebar and back-to-dashboard behavior keep the pages consistent.',
        'Modal forms use required and optional indicators so users can see what must be filled in.',
        'Search bars, dropdowns, and autocomplete pickers are used where the list can become long.',
        'Duplicate checks are enforced for important fields such as names, phone numbers, TIN, usernames, and codes.',
        'Phone values are capped at 12 digits and TIN values use the 000-000-000-000 pattern.'
      )
    },
    @{
      Title = '7. Security and Access Control'
      Bullets = @(
        'Login protection and session handling restrict access to protected pages.',
        'Role-based access separates admin, staff, and user capabilities.',
        'Server-side validation is used to block duplicate entries and malformed data even if the UI is bypassed.',
        'Archive and restore flows preserve history without losing important records.',
        'File upload handling is limited to controlled PDF attachments.'
      )
    },
    @{
      Title = '8. Deployment and Maintenance'
      Bullets = @(
        'The system runs on Node.js and PostgreSQL in the current development or deployment environment.',
        'Configuration values are stored in .env and should be reviewed before go-live.',
        'Backup and recovery files are kept in the repository for operational safety.',
        'Cache-busting is used on the frontend so layout changes appear immediately after refresh.',
        'The codebase is organized by module to reduce spaghetti code and simplify future updates.'
      )
    },
    @{
      Title = '9. Conclusion'
      Bullets = @(
        'KVSK CCTV & IT Solution ERP is a project-centered business system designed to keep company records, project data, procurement, receivables, payables, and reporting in one place.',
        'The system is structured for easier maintenance, safer data handling, and cleaner day-to-day workflow.',
        'It is ready for demo, documentation, and further enhancement as the business grows.'
      )
    }
  )

  foreach ($section in $sections) {
    $paragraphs.Add((New-DocxParagraph -Text $section.Title -SizePt 17 -Color '1F4E79' -Bold -Before 180 -After 60))
    foreach ($bullet in $section.Bullets) {
      $paragraphs.Add((New-DocxParagraph -Text "- $bullet" -SizePt 11 -Color '2E3A4A' -Left 720 -Hanging 360 -After 55))
    }
  }

  $docXml = New-DocxDocumentXml -Paragraphs $paragraphs.ToArray()
  Write-DocxFile -Path $Path -Title $Title -Paragraphs $paragraphs.ToArray()

  if ($ScreenshotDir -and (Test-Path $ScreenshotDir)) {
    Append-UiScreenshotsToDocx -Path $Path -ScreenshotDir $ScreenshotDir
  }
}

function New-SystemPptx {
  param(
    [string]$Path,
    [string]$Title,
    [string]$GeneratedDateLong,
    [string]$ScreenshotDir
  )

  if (Test-Path $Path) {
    Remove-Item -LiteralPath $Path -Force
  }

  $ppt = New-Object -ComObject PowerPoint.Application
  $ppt.Visible = -1
  $ppt.DisplayAlerts = 1

  try {
    $pres = $ppt.Presentations.Add()
    $pres.PageSetup.SlideWidth = 960
    $pres.PageSetup.SlideHeight = 540

    Add-TitleSlide -Presentation $pres `
      -Title 'KVSK CCTV & IT Solution' `
      -Subtitle 'ERP System Documentation' `
      -Tagline 'Project-centered operations, finance, procurement, and reporting' | Out-Null

    Add-ContentSlide -Presentation $pres `
      -Title 'System Overview' `
      -Bullets @(
        'Centralized ERP platform for KVSK CCTV & IT Solution.',
        'Project-centered workflow with company and vendor records supporting each project.',
        'Tracks projects, service orders, transactions, payables, receivables, procurement, users, and logs.',
        'Shared UI components keep the experience consistent across modules.'
      ) `
      -SlideNumberLabel '01 / 16' | Out-Null

    Add-ContentSlide -Presentation $pres `
      -Title 'Main Modules' `
      -Bullets @(
        'Login and authentication.',
        'Dashboard and project operations.',
        'Company Registry.',
        'Procurement, Accounts Payable, and Accounts Receivable.',
        'Reports and analytics.',
        'User Management and system access control.'
      ) `
      -SlideNumberLabel '02 / 16' | Out-Null

    Add-ContentSlide -Presentation $pres `
      -Title 'Core Workflow' `
      -Bullets @(
        'Company Registry -> Projects -> Service Orders -> Transactions -> Accounts Receivable.',
        'Purchase Requisition -> Purchase Order -> Goods Receipt.',
        'Vendor -> Bill -> Payment.',
        'Project relationships keep the records traceable from start to finish.'
      ) `
      -SlideNumberLabel '03 / 16' | Out-Null

    Add-ContentSlide -Presentation $pres `
      -Title 'Database Model' `
      -Bullets @(
        'Key tables: company_registry, projects, service_orders, transactions, vendors.',
        'Procurement tables: purchase_requisitions, purchase_orders, goods_receipts.',
        'Accounting tables: accounts_payable, accounts_receivable, payments, journal_entries, journal_lines.',
        'Support tables: users, system_logs.'
      ) `
      -SlideNumberLabel '04 / 16' | Out-Null

    Add-ContentSlide -Presentation $pres `
      -Title 'UI and Validation' `
      -Bullets @(
        'Shared sidebar and back buttons keep pages aligned.',
        'Required and optional fields are labeled clearly in modals.',
        'Search bars and autocomplete pickers are used for long lists.',
        'Duplicate checks protect names, phone numbers, TIN, usernames, and codes.',
        'Phone values are capped at 12 digits and TIN uses the 000-000-000-000 format.'
      ) `
      -SlideNumberLabel '05 / 16' | Out-Null

    Add-ContentSlide -Presentation $pres `
      -Title 'Security and Deployment' `
      -Bullets @(
        'Role-based access separates admin, staff, and user permissions.',
        'Server-side validation blocks invalid or duplicate records.',
        'Backup and recovery files support safer maintenance.',
        'The system is designed for a Node.js + PostgreSQL setup.'
      ) `
      -SlideNumberLabel '06 / 16' | Out-Null

    Add-ContentSlide -Presentation $pres `
      -Title 'Conclusion' `
      -Bullets @(
        'The ERP system keeps company, project, procurement, finance, and reporting data in one place.',
        'The structure is organized to reduce spaghetti code and support future improvements.',
        'It is ready for demo, documentation, and controlled deployment.'
      ) `
      -SlideNumberLabel '07 / 16' | Out-Null

    foreach ($spec in (Get-UiScreenshotSpecs)) {
      [void](Add-UiMockupSlide -Presentation $pres -Spec $spec)
    }

    $pres.SaveAs($Path, 24)

    if ($ScreenshotDir) {
      New-Item -ItemType Directory -Path $ScreenshotDir -Force | Out-Null
      $specs = Get-UiScreenshotSpecs
      for ($i = 0; $i -lt $specs.Count; $i++) {
        $slideIndex = 9 + $i
        $slide = $pres.Slides.Item($slideIndex)
        $exportPath = Join-Path $ScreenshotDir $specs[$i].FileName
        try {
          if (Test-Path $exportPath) { Remove-Item -LiteralPath $exportPath -Force }
        } catch {}
        [void]$slide.Export($exportPath, 'PNG', 1600, 900)
      }
    }
    $pres.Close()
  } finally {
    if ($pres) {
      try { $pres.Close() } catch {}
      [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($pres)
    }
    if ($ppt) {
      try { $ppt.Quit() } catch {}
      [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($ppt)
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
  }
}

$systemTitle = 'KVSK CCTV & IT Solution ERP System'
Write-Host "Generating Word documentation..."
New-SystemDocx -Path $docxPath -Title $systemTitle -GeneratedDateLong $generatedDateLong -ScreenshotDir (Join-Path $docsDir 'screenshots')
Write-Host "Generating PowerPoint presentation..."
New-SystemPptx -Path $pptxPath -Title $systemTitle -GeneratedDateLong $generatedDateLong -ScreenshotDir (Join-Path $docsDir 'screenshots')

Write-Host "Done:"
Write-Host " - $docxPath"
Write-Host " - $pptxPath"
