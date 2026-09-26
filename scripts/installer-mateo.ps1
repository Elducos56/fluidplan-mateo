<#
.SYNOPSIS
  Installe la copie de fluidplan de Mateo comme compétence Claude Code, figée sur un commit.

.DESCRIPTION
  1. Refuse si le dépôt a des modifications non commitées : on n'installe que ce qui est testé et versionné.
  2. Clone ce dépôt dans le dossier de la compétence (par défaut ~/.claude/skills/fluidplan),
     détaché sur le commit courant ; si ce dossier est déjà une installation de fluidplan-mateo,
     il est mis à jour vers ce commit. Tout autre contenu dans le dossier cible fait refuser.
  3. Écrit INSTALLED.txt (commit, branche, date) dans l'installation.
  4. Ajoute une trace datée dans ~/.claude/fluidplan-install.jsonl, même en simulation (-WhatIf).

  Revenir en arrière : relancer ce script depuis un commit plus ancien, ou remettre l'original
  archivé dans C:\Users\mateo\Archives\fluidplan-origine-755d1b2\ (voir docs/MATEO.md).

.EXAMPLE
  pwsh scripts/installer-mateo.ps1 -WhatIf
  pwsh scripts/installer-mateo.ps1
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$Target = (Join-Path $HOME ".claude\skills\fluidplan"),
  [string]$Remote = "https://github.com/Elducos56/fluidplan-mateo.git"
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$trace = Join-Path $HOME ".claude\fluidplan-install.jsonl"

function Write-Trace([string]$result, [string]$detail) {
  $line = [ordered]@{ at = (Get-Date).ToString("o"); commit = $script:commit; branch = $script:branch; target = $Target; whatif = [bool]$WhatIfPreference; result = $result; detail = $detail } | ConvertTo-Json -Compress
  Add-Content -LiteralPath $trace -Value $line -Encoding utf8 -WhatIf:$false
}

$script:commit = (git -C $repo rev-parse HEAD).Trim()
$script:branch = (git -C $repo rev-parse --abbrev-ref HEAD).Trim()

$dirty = git -C $repo status --porcelain --untracked-files=no
if ($dirty) {
  Write-Trace "refused" "uncommitted changes"
  throw "Installation refusée : le dépôt a des modifications non commitées. Commite-les d'abord.`n$dirty"
}

$existing = $null
if (Test-Path -LiteralPath $Target) {
  $isClone = Test-Path -LiteralPath (Join-Path $Target ".git")
  $origin = if ($isClone) { (git -C $Target remote get-url origin 2>$null) } else { $null }
  if (-not $isClone -or $origin -notmatch "fluidplan-mateo") {
    Write-Trace "refused" "target exists and is not a fluidplan-mateo install"
    throw "Installation refusée : $Target existe et n'est pas une installation de fluidplan-mateo. Archive-le d'abord (docs/MATEO.md)."
  }
  $existing = (git -C $Target rev-parse HEAD).Trim()
}

if ($PSCmdlet.ShouldProcess($Target, "installer fluidplan-mateo au commit $commit ($branch)")) {
  if ($existing) {
    git -C $Target fetch --quiet $repo $commit
    git -C $Target checkout --quiet --detach $commit
  } else {
    git clone --quiet --no-checkout $repo $Target
    git -C $Target checkout --quiet --detach $commit
    git -C $Target remote set-url origin $Remote
  }
  if ($LASTEXITCODE -ne 0) { Write-Trace "failed" "git exited with $LASTEXITCODE"; throw "git a échoué ($LASTEXITCODE)" }
  Add-Content -LiteralPath (Join-Path $Target ".git\info\exclude") -Value "INSTALLED.txt" -Encoding utf8
  @(
    "commit: $commit",
    "branch: $branch",
    "installed_at: $((Get-Date).ToString('o'))",
    "source: $Remote"
  ) | Set-Content -LiteralPath (Join-Path $Target "INSTALLED.txt") -Encoding utf8
  Write-Trace "installed" $(if ($existing) { "updated from $existing" } else { "fresh clone" })
  Write-Host "fluidplan-mateo installé : $Target au commit $commit ($branch)"
} else {
  Write-Trace "simulated" $(if ($existing) { "would update from $existing" } else { "would clone" })
}
