$ErrorActionPreference = 'SilentlyContinue'

$repoPath = 'C:\project\liberlive-harmonyOS'
$url = 'http://localhost:4747/?project=liberlive-harmonyOS&server=http%3A%2F%2Flocalhost%3A4747'
$healthUrl = 'http://localhost:4747/api/health'

function Test-GitNexusReady {
  try {
    $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

if (-not (Test-GitNexusReady)) {
  Start-Process -FilePath 'gitnexus.cmd' -ArgumentList @('serve', '--port', '4747') -WorkingDirectory $repoPath -WindowStyle Hidden

  for ($i = 0; $i -lt 30; $i += 1) {
    Start-Sleep -Milliseconds 500
    if (Test-GitNexusReady) {
      break
    }
  }
}

Start-Process $url
