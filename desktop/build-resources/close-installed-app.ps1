param(
    [Parameter(Mandatory = $true)][string]$AppExe,
    [Parameter(Mandatory = $true)][string]$Destination,
    [string]$Installed,
    [string]$OtherInstalled
)

$ErrorActionPreference = 'Stop'

function Get-InstallProcessPaths {
    foreach ($root in @($Destination, $Installed, $OtherInstalled)) {
        # NSIS appends \., so CreateProcess doesn't parse a trailing slash as an escaped quote.
        if ($root -notmatch '^(?:[a-z]:\\|\\\\[^\\]+\\[^\\]+\\)') { continue }
        $root = [IO.Path]::GetFullPath($root)
        $main = Join-Path $root $AppExe
        if (-not (Test-Path -LiteralPath $main -PathType Leaf)) { continue }
        $main
        Join-Path $root 'resources\backend-gateway-headless.exe'
        Join-Path $root 'resources\cloudflared.exe'
    }
}

function Get-ProcessSnapshot {
    Get-CimInstance -ClassName Win32_Process -Property ProcessId,ParentProcessId,ExecutablePath,Name,SessionId,CreationDate
}

function Find-InstallProcesses($Snapshot, $Paths) {
    $Snapshot | Where-Object { $_.ExecutablePath -in $Paths }
}

function Get-OwnedOllama($Snapshot, $Roots) {
    $parents = @{}
    foreach ($root in $Roots) {
        if ($root.Name -eq 'backend-gateway-headless.exe' -and $root.SessionId -eq $session) {
            if ((Invoke-CimMethod -InputObject $root -MethodName GetOwnerSid).Sid -eq $ownerSid) {
                $parents[$root.ProcessId] = $root
            }
        }
    }
    if ($parents.Count -eq 0) { return }

    # Only Ollama workers descended from these exact gateways, never a separately launched Ollama.
    $remaining = @($Snapshot | Where-Object { $_.Name -eq 'ollama.exe' -and $_.SessionId -eq $session })
    do {
        $found = @($remaining | Where-Object {
            $parent = $parents[$_.ParentProcessId]
            $parent -and $parent.CreationDate -le $_.CreationDate -and
                (Invoke-CimMethod -InputObject $_ -MethodName GetOwnerSid).Sid -eq $ownerSid
        })
        foreach ($child in $found) {
            $parents[$child.ProcessId] = $child
            $child
        }
        $remaining = @($remaining | Where-Object { -not $parents.ContainsKey($_.ProcessId) })
    } while ($found.Count -gt 0)
}

function Get-MatchingProcess($Entry) {
    $proc = Get-Process -Id $Entry.ProcessId -ErrorAction SilentlyContinue
    if ($null -eq $proc) { return }
    try {
        # Bind to the actual process before acting; a PID may have been recycled.
        $null = $proc.Handle
        $sameStart = [Math]::Abs(($proc.StartTime - $Entry.CreationDate).TotalMilliseconds) -lt 1
        if ($sameStart) {
            # 32-bit NSIS can launch 32-bit PowerShell; Get-Process.Path is empty
            # for a 64-bit target there. CIM queries the path across bitness.
            $current = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId=$($Entry.ProcessId)"
            if ($current.ExecutablePath -eq $Entry.ExecutablePath -and
                $current.CreationDate -eq $Entry.CreationDate) { return $proc }
        }
    } catch [System.InvalidOperationException] {
        if (-not $proc.HasExited) { throw }
    }
    $proc.Dispose()
}

try {
    $paths = @(Get-InstallProcessPaths | Select-Object -Unique)
    if ($paths.Count -eq 0) { exit 0 }

    $session = (Get-Process -Id $PID).SessionId
    $ownerSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $snapshot = @(Get-ProcessSnapshot)
    $roots = @(Find-InstallProcesses $snapshot $paths)
    $ollama = @(Get-OwnedOllama $snapshot $roots)

    $requestedClose = $false
    foreach ($entry in $roots) {
        if ($entry.Name -ne $AppExe -or $entry.SessionId -ne $session) { continue }
        if ((Invoke-CimMethod -InputObject $entry -MethodName GetOwnerSid).Sid -ne $ownerSid) { continue }
        $proc = Get-MatchingProcess $entry
        if ($proc) {
            try { if ($proc.CloseMainWindow()) { $requestedClose = $true } }
            finally { $proc.Dispose() }
        }
    }
    if ($requestedClose) {
        # Give newer releases time for an orderly gateway shutdown first.
        $deadline = [DateTime]::UtcNow.AddSeconds(6)
        do {
            Start-Sleep -Milliseconds 200
            $snapshot = @(Get-ProcessSnapshot)
            $roots = @(Find-InstallProcesses $snapshot $paths)
        } while ($roots.Count -gt 0 -and [DateTime]::UtcNow -lt $deadline)
    }

    for ($attempt = 0; $attempt -lt 3; $attempt++) {
        $ollama += @(Get-OwnedOllama $snapshot $roots)
        # Stop exact install executables before any remaining Ollama children.
        $remaining = @($roots + $ollama | Sort-Object ProcessId,CreationDate -Unique)
        if ($remaining.Count -eq 0) { break }
        foreach ($entry in $remaining) {
            if ($entry.SessionId -ne $session) { continue }
            $proc = Get-MatchingProcess $entry
            if (-not $proc) { continue }
            try {
                if ((Invoke-CimMethod -InputObject $entry -MethodName GetOwnerSid).Sid -ne $ownerSid) { continue }
                if (-not $proc.HasExited) {
                    Write-Output ('Closing {0} (PID {1})' -f $entry.Name, $entry.ProcessId)
                    $proc.Kill()
                    $null = $proc.WaitForExit(1500)
                }
            } catch {
                if (-not $proc.HasExited) { throw }
            } finally { $proc.Dispose() }
        }
        $snapshot = @(Get-ProcessSnapshot)
        $roots = @(Find-InstallProcesses $snapshot $paths)
        $ollama = @($ollama | Where-Object {
            $worker = $_
            $snapshot | Where-Object { $_.ProcessId -eq $worker.ProcessId -and $_.CreationDate -eq $worker.CreationDate }
        })
        if (($roots.Count + $ollama.Count) -eq 0) { break }
    }
    if (($roots.Count + $ollama.Count) -gt 0) { throw 'Hymnix installation processes are still running.' }
    exit 0
} catch {
    Write-Output $_.Exception.Message
    exit 2
}
