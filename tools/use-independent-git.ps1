# Run once from a normal PowerShell terminal. This changes only this checkout's gitfile.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$metadataPath = Join-Path $projectRoot '.somnus-git'
$gitfilePath = Join-Path $projectRoot '.git'
if (!(Test-Path -LiteralPath (Join-Path $metadataPath 'HEAD'))) {
    throw 'Independent Git metadata is missing. A fresh clone already has its own .git and needs no repair.'
}
if ((Get-Item -Force -LiteralPath $gitfilePath).PSIsContainer) {
    throw 'This checkout already has a .git directory. Do not replace it.'
}
$oldGitfile = [IO.File]::ReadAllText($gitfilePath)
if ($oldGitfile.Trim() -ne 'gitdir: .somnus-git') {
    [IO.File]::WriteAllText((Join-Path $metadataPath 'previous-gitfile.txt'), $oldGitfile)
    # FileMode.Create (used by WriteAllText) rejects existing hidden files on Windows.
    # Open the existing file without changing its attributes or permissions.
    $bytes = [Text.Encoding]::UTF8.GetBytes("gitdir: .somnus-git`n")
    $stream = [IO.File]::Open($gitfilePath, [IO.FileMode]::Open, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try {
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.SetLength($bytes.Length)
        $stream.Flush()
    } finally {
        $stream.Dispose()
    }
}
& git -C $projectRoot status --short --branch
if ($LASTEXITCODE -ne 0) { throw 'Git status failed. The previous gitfile is saved in .somnus-git/previous-gitfile.txt.' }
