param(
  [string]$CorpusPath = (Join-Path $PSScriptRoot '..\benchmark\corpus.json'),
  [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\public\benchmark-audio'),
  [string]$VoiceName = 'Microsoft David Desktop - English (United States)',
  [int]$Rate = 0,
  [int]$Volume = 100
)

$ErrorActionPreference = 'Stop'
$corpus = Get-Content -LiteralPath $CorpusPath -Raw | ConvertFrom-Json
if ($corpus.Count -ne 30) {
  throw "Expected 30 corpus entries, found $($corpus.Count)."
}

$ids = @($corpus | ForEach-Object { $_.id })
if (($ids | Sort-Object -Unique).Count -ne $corpus.Count) {
  throw 'Corpus command IDs must be unique.'
}

$validPages = @('dashboard', 'projects', 'tasks', 'workload', 'employees', 'analytics', 'settings', 'integrations')
foreach ($entry in $corpus) {
  if ([string]::IsNullOrWhiteSpace($entry.text)) {
    throw "Corpus entry $($entry.id) has no text."
  }
  if ($null -ne $entry.expectedPageId -and $entry.expectedPageId -notin $validPages) {
    throw "Corpus entry $($entry.id) has invalid page $($entry.expectedPageId)."
  }
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
Copy-Item -LiteralPath $CorpusPath -Destination (Join-Path $OutputDirectory 'corpus.json') -Force

$voice = New-Object -ComObject SAPI.SpVoice
$voiceToken = $voice.GetVoices() | Where-Object { $_.GetDescription() -eq $VoiceName } | Select-Object -First 1
if (-not $voiceToken) {
  throw "Windows TTS voice not found: $VoiceName"
}

$voice.Voice = $voiceToken
$voice.Rate = $Rate
$voice.Volume = $Volume

try {
  foreach ($entry in $corpus) {
    $stream = New-Object -ComObject SAPI.SpFileStream
    $format = New-Object -ComObject SAPI.SpAudioFormat
    try {
      # SpeechAudioFormatType.SAFT16kHz16BitMono
      $format.Type = 18
      $stream.Format = $format
      $path = Join-Path $OutputDirectory "$($entry.id).wav"
      # SpeechStreamFileMode.SSFMCreateForWrite
      $stream.Open($path, 3, $false)
      $voice.AudioOutputStream = $stream
      [void]$voice.Speak([string]$entry.text)
      $stream.Close()
      Write-Output "Generated $($entry.id): $($entry.text)"
    } finally {
      try { $stream.Close() } catch { }
      [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($format)
      [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($stream)
    }
  }
} finally {
  $voice.AudioOutputStream = $null
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($voiceToken)
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($voice)
}

$metadata = [ordered]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  voice = $VoiceName
  rate = $Rate
  volume = $Volume
  sampleRate = 16000
  channels = 1
  bitsPerSample = 16
  commandCount = $corpus.Count
}
$metadata | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $OutputDirectory 'metadata.json') -Encoding UTF8
