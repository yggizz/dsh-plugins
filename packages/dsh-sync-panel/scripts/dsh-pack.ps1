# dsh-pack.ps1 —— 把「本地插件源码 + profile 配置」打成一个可搬到另一台电脑的 zip
#
# 只打包必要的东西：
#   - profile package.json 里所有 link: 指向的本地插件（排除 node_modules / .data / .git / __pycache__ 等缓存）
#   - profile 的 cordis.patch.yml、package.json、pnpm-lock.yaml、pnpm-workspace.yaml
#   - 可选：~/.dsh/.agent-presets（自定义 agent 预设）
# 不打包：sessions、session-trash、attachments、node_modules、插件运行时缓存、任何凭据文件。
#
# 用法（PowerShell 7 和 Windows PowerShell 5.1 都可以；5.1 用 powershell.exe -NoProfile -ExecutionPolicy Bypass -File）：
#   pwsh -File dsh-pack.ps1
#   pwsh -File dsh-pack.ps1 -IncludePresets
#   pwsh -File dsh-pack.ps1 -ProfileDir "C:\Users\xxx\.dsh\profiles\desktop" -OutDir "D:\传递"

[CmdletBinding()]
param(
  [string]$ProfileDir = "$env:USERPROFILE\.dsh\profiles\desktop",
  [string]$OutDir = "$env:USERPROFILE\Documents\deepseek-harness\default-workspace",
  [switch]$IncludePresets
)

$ErrorActionPreference = 'Stop'

$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
$stage = Join-Path $env:TEMP "dsh-pack-$stamp"
$zipName = "dsh-sync-$stamp.zip"
$zipPath = Join-Path $OutDir $zipName

# 这些目录/文件是缓存或本机状态，同步过去只会变慢或打架
$excludeNames = @('node_modules', '.data', '.git', '__pycache__', '.venv', '.cache', 'cache', 'tmp', '.DS_Store')
# 配置里明确不带走的敏感文件
$sensitiveNames = @('imap_config.json', '.env', 'credentials.json', 'auth.json')

function Copy-Tree {
  param([string]$Source, [string]$Destination)
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  foreach ($item in Get-ChildItem -LiteralPath $Source -Force) {
    if ($excludeNames -contains $item.Name) { continue }
    if ($sensitiveNames -contains $item.Name) { Write-Host "  跳过敏感文件 $($item.Name)" -ForegroundColor Yellow; continue }
    $target = Join-Path $Destination $item.Name
    if ($item.PSIsContainer) { Copy-Tree -Source $item.FullName -Destination $target }
    else { Copy-Item -LiteralPath $item.FullName -Destination $target -Force }
  }
}

function Get-HashTable {
  param([string]$Root)
  $list = @()
  $prefix = $Root.TrimEnd('\') + '\'
  foreach ($file in Get-ChildItem -LiteralPath $Root -Recurse -File -Force) {
    # 不用 [IO.Path]::GetRelativePath：Windows PowerShell 5.1 的 .NET 里没有这个方法
    $rel = $file.FullName.Substring($prefix.Length).Replace('\', '/')
    $list += [pscustomobject]@{
      rel    = $rel
      size   = $file.Length
      sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLower()
    }
  }
  return $list
}

if (-not (Test-Path -LiteralPath (Join-Path $ProfileDir 'package.json'))) {
  throw "找不到 profile：$ProfileDir（里面应当有 package.json）"
}

Write-Host "读取 profile：$ProfileDir" -ForegroundColor Cyan
$profilePkg = Get-Content -LiteralPath (Join-Path $ProfileDir 'package.json') -Raw -Encoding utf8 | ConvertFrom-Json
$localDeps = @()
foreach ($prop in $profilePkg.dependencies.PSObject.Properties) {
  if ([string]$prop.Value -like 'link:*') {
    $localDeps += [pscustomobject]@{ name = $prop.Name; target = ([string]$prop.Value -replace '^link:', '') }
  }
}
if ($localDeps.Count -eq 0) { throw 'profile 里没有任何 link: 本地插件，没什么可打包的' }

New-Item -ItemType Directory -Force -Path $stage | Out-Null
$pluginsStage = Join-Path $stage 'plugins'
New-Item -ItemType Directory -Force -Path $pluginsStage | Out-Null

$manifestPlugins = @()
$usedDirNames = @{}
foreach ($dep in $localDeps) {
  $src = $dep.target
  if (-not (Test-Path -LiteralPath $src)) {
    Write-Host "  跳过（源目录不存在）：$($dep.name) -> $src" -ForegroundColor Yellow
    continue
  }
  # @local/dsh-x 这种带 scope 的，落到目录上只留包名 dsh-x；重名时退回完整写法
  $dirName = $dep.name
  if ($dirName -match '^@[^/\\]+[\\/](.+)$') { $dirName = $matches[1] }
  $dirName = $dirName.Replace('/', '_').Replace('\', '_')
  if ($usedDirNames.ContainsKey($dirName)) {
    $dirName = $dep.name.Replace('/', '__').Replace('\', '__')
  }
  $usedDirNames[$dirName] = $true
  $dst = Join-Path $pluginsStage $dirName
  Copy-Tree -Source $src -Destination $dst
  $files = Get-HashTable -Root $dst
  $manifestPlugins += [pscustomobject]@{
    name    = $dep.name
    dirName = $dirName
    source  = $src
    files   = $files
  }
  Write-Host ("  插件 {0,-34} {1,4} 个文件  {2} KB" -f $dep.name, $files.Count, [math]::Round((($files | Measure-Object size -Sum).Sum) / 1KB)) -ForegroundColor Green
}

# profile 配置文件
$profileFiles = @()
foreach ($name in @('cordis.patch.yml', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.yml')) {
  $p = Join-Path $ProfileDir $name
  if (-not (Test-Path -LiteralPath $p)) { continue }
  Copy-Item -LiteralPath $p -Destination (Join-Path $stage $name) -Force
  $profileFiles += [pscustomobject]@{
    name   = $name
    size   = (Get-Item -LiteralPath $p).Length
    sha256 = (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLower()
  }
  Write-Host "  配置 $name" -ForegroundColor Green
}

# 可选：自定义 agent 预设
if ($IncludePresets) {
  $presetRoot = Join-Path $env:USERPROFILE '.dsh\.agent-presets'
  if (Test-Path -LiteralPath $presetRoot) {
    Copy-Tree -Source $presetRoot -Destination (Join-Path $stage 'agent-presets')
    Write-Host '  已带上 .agent-presets' -ForegroundColor Green
  }
}

# DSH 本体版本：版本不一致时插件可能装不上，写进清单便于对照
$dshVersion = ''
$asar = 'D:\Program Files\DeepSeek Harness\resources\app.asar'
if (Test-Path -LiteralPath $asar) {
  $dshVersion = (Get-Item -LiteralPath $asar).LastWriteTime.ToString('yyyy-MM-dd HH:mm')
}

$manifest = [pscustomobject]@{
  format      = 1
  createdAt   = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  machine     = $env:COMPUTERNAME
  user        = $env:USERNAME
  profileDir  = $ProfileDir
  dshAsarTime = $dshVersion
  plugins     = $manifestPlugins
  profileFiles = $profileFiles
  presets     = [bool]$IncludePresets
}
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $stage 'manifest.json') -Encoding utf8

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zipPath -CompressionLevel Optimal

$zipSize = [math]::Round((Get-Item -LiteralPath $zipPath).Length / 1MB, 2)
Remove-Item -LiteralPath $stage -Recurse -Force

Write-Host ''
Write-Host "打包完成：$zipPath（$zipSize MB，$($manifestPlugins.Count) 个插件，$($profileFiles.Count) 个配置文件）" -ForegroundColor Cyan
Write-Host '另一台电脑上执行：pwsh -File dsh-restore.ps1 -Zip <这个 zip 的路径>' -ForegroundColor Cyan
