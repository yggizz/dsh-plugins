# dsh-restore.ps1 —— 在另一台电脑上还原 dsh-pack.ps1 打出的 zip
#
# 做的事：
#   1. 把插件源码解到 -PluginsRoot（默认 %USERPROFILE%\Documents\dsh-sync\plugins）
#   2. 按本机路径重写 profile/package.json 里的 link: 依赖（这是两台机器路径不同的关键）
#   3. 覆盖 cordis.patch.yml / pnpm-lock.yaml / pnpm-workspace.yaml（原文件先备份成 *.bak-时间戳）
#   4. 用 DSH 自带的 pnpm 跑一次 install 重建 node_modules
#   5. 逐文件核对 SHA256，报出不一致的文件
#
# 用法（PowerShell 7 和 Windows PowerShell 5.1 都可以；5.1 用 powershell.exe -NoProfile -ExecutionPolicy Bypass -File）：
#   pwsh -File dsh-restore.ps1 -Zip .\dsh-sync-20261114-1950.zip
#   pwsh -File dsh-restore.ps1 -Zip ... -SkipInstall
#   pwsh -File dsh-restore.ps1 -Zip ... -PluginsRoot "D:\dsh-sync\plugins"

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Zip,
  [string]$ProfileDir = "$env:USERPROFILE\.dsh\profiles\desktop",
  [string]$PluginsRoot = "$env:USERPROFILE\Documents\dsh-sync\plugins",
  [switch]$SkipInstall,
  [switch]$ForcePluginsRoot,
  [switch]$KeepBackup
)

$ErrorActionPreference = 'Stop'
$stamp = Get-Date -Format 'yyyyMMdd-HHmm'

if (-not (Test-Path -LiteralPath $Zip)) { throw "找不到 zip：$Zip" }
if (-not (Test-Path -LiteralPath (Join-Path $ProfileDir 'package.json'))) {
  throw "找不到 profile：$ProfileDir（先确认 DSH 装在哪个用户下）"
}

$stage = Join-Path $env:TEMP "dsh-restore-$stamp"
Expand-Archive -LiteralPath $Zip -DestinationPath $stage -Force
$manifestPath = Join-Path $stage 'manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath)) { throw 'zip 里没有 manifest.json，可能不是 dsh-pack 打的包' }
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding utf8 | ConvertFrom-Json

Write-Host "来源：$($manifest.machine) / $($manifest.createdAt)（$($manifest.plugins.Count) 个插件）" -ForegroundColor Cyan
if ($manifest.dshAsarTime) { Write-Host "打包机的 DSH 本体时间：$($manifest.dshAsarTime)（本机版本最好一致）" -ForegroundColor DarkGray }

# ---------- 1. 插件源码 ----------
New-Item -ItemType Directory -Force -Path $PluginsRoot | Out-Null
$linkMap = @{}
$hashMismatch = 0
$hashChecked = 0

foreach ($plugin in $manifest.plugins) {
  $src = Join-Path (Join-Path $stage 'plugins') $plugin.dirName
  # 打包机的源码路径如果在本机也存在（两台机器布局一样），就原地更新，link 都不用改；
  # 否则落到 -PluginsRoot，并把 link 改到那里。-ForcePluginsRoot 可以强制走后者。
  $preferred = [string]$plugin.source
  if (-not $ForcePluginsRoot -and $preferred -ne '' -and (Test-Path -LiteralPath $preferred)) {
    $dst = $preferred
  } else {
    $dst = Join-Path $PluginsRoot $plugin.dirName
  }
  if (Test-Path -LiteralPath $dst) {
    $bak = "$dst.bak-$stamp"
    Move-Item -LiteralPath $dst -Destination $bak -Force
    if (-not $KeepBackup) { Write-Host "  旧版另存：$bak" -ForegroundColor DarkYellow }
  }
  Copy-Item -LiteralPath $src -Destination $dst -Recurse -Force
  $linkMap[$plugin.name] = $dst.Replace('\', '/')
  Write-Host ("  插件 {0,-34} -> {1}" -f $plugin.name, $dst) -ForegroundColor Green

  foreach ($f in $plugin.files) {
    $target = Join-Path $dst ($f.rel -replace '/', [System.IO.Path]::DirectorySeparatorChar)
    if (-not (Test-Path -LiteralPath $target)) { $hashMismatch++; Write-Host "    缺文件：$($f.rel)" -ForegroundColor Red; continue }
    $hashChecked++
    $actual = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLower()
    if ($actual -ne $f.sha256) { $hashMismatch++; Write-Host "    内容不一致：$($f.rel)" -ForegroundColor Red }
  }
}

# ---------- 2. 重写 profile/package.json ----------
$profilePkgPath = Join-Path $ProfileDir 'package.json'
$backup = "$profilePkgPath.bak-$stamp"
Copy-Item -LiteralPath $profilePkgPath -Destination $backup -Force
Write-Host "  已备份原 package.json -> $backup" -ForegroundColor DarkGray

# zip 里的 package.json 是打包机的版本，先拿来当底稿，再把 link 路径改成本机路径
$packedPkgPath = Join-Path $stage 'package.json'
if (Test-Path -LiteralPath $packedPkgPath) {
  Copy-Item -LiteralPath $packedPkgPath -Destination $profilePkgPath -Force
}
$pkg = Get-Content -LiteralPath $profilePkgPath -Raw -Encoding utf8 | ConvertFrom-Json

$missingBundles = @()
foreach ($name in $linkMap.Keys) {
  $pkg.dependencies | Add-Member -NotePropertyName $name -NotePropertyValue ("link:" + $linkMap[$name]) -Force
  if ($pkg.dsh.profile.bundles -notcontains $name) { $missingBundles += $name }
}
$pkg | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $profilePkgPath -Encoding utf8 -NoNewline
Write-Host "  已按本机路径改写 $($linkMap.Count) 个 link: 依赖" -ForegroundColor Green
if ($missingBundles.Count -gt 0) {
  Write-Host "  注意：这些插件在 dependencies 里但不在 bundles 里，DSH 不会加载它们：$($missingBundles -join '、')" -ForegroundColor Yellow
}

# ---------- 3. 其它配置文件 ----------
foreach ($f in $manifest.profileFiles) {
  if ($f.name -eq 'package.json') { continue }   # 上面已经单独处理
  $src = Join-Path $stage $f.name
  if (-not (Test-Path -LiteralPath $src)) { continue }
  $dst = Join-Path $ProfileDir $f.name
  if (Test-Path -LiteralPath $dst) { Copy-Item -LiteralPath $dst -Destination "$dst.bak-$stamp" -Force }
  Copy-Item -LiteralPath $src -Destination $dst -Force
  Write-Host "  配置 $($f.name) 已更新" -ForegroundColor Green
}

# ---------- 4. agent 预设 ----------
$presetSrc = Join-Path $stage 'agent-presets'
if (Test-Path -LiteralPath $presetSrc) {
  $presetDst = Join-Path $env:USERPROFILE '.dsh\.agent-presets'
  New-Item -ItemType Directory -Force -Path $presetDst | Out-Null
  Copy-Item -Path (Join-Path $presetSrc '*') -Destination $presetDst -Recurse -Force
  Write-Host '  .agent-presets 已更新' -ForegroundColor Green
}

# ---------- 5. 装依赖 ----------
if (-not $SkipInstall) {
  $runtimeRoot = Join-Path $env:USERPROFILE '.dsh\dsh-runtimes'
  $pnpm = Get-ChildItem -Path $runtimeRoot -Recurse -Filter 'pnpm.mjs' -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -like '*pnpm\bin\pnpm.mjs' } | Select-Object -First 1
  if ($null -eq $pnpm) {
    Write-Host '  没找到 DSH 自带的 pnpm，跳过安装。请手动在 profile 目录执行 pnpm install。' -ForegroundColor Yellow
  } else {
    $node = Join-Path (Split-Path (Split-Path (Split-Path $pnpm.FullName))) 'node\bin\node.exe'
    if (-not (Test-Path -LiteralPath $node)) { $node = 'node' }
    Write-Host "  执行 pnpm install（$($pnpm.FullName)）…" -ForegroundColor Cyan
    & $node $pnpm.FullName install --dir $ProfileDir
    if ($LASTEXITCODE -ne 0) { throw "pnpm install 失败（exit $LASTEXITCODE）" }
    Write-Host '  依赖已重建' -ForegroundColor Green
  }
}

Remove-Item -LiteralPath $stage -Recurse -Force

Write-Host ''
Write-Host '还原完成。' -ForegroundColor Cyan
if ($hashChecked -gt 0) {
  $state = if ($hashMismatch -eq 0) { '全部一致' } else { "$hashMismatch 处不一致" }
  Write-Host "  文件校验：核对 $hashChecked 个文件，$state" -ForegroundColor $(if ($hashMismatch -eq 0) { 'Green' } else { 'Yellow' })
}
Write-Host '  最后一步：重启 DSH（Host 插件与 profile 配置只在启动时加载）。' -ForegroundColor Cyan
if (-not $KeepBackup) { Write-Host "  备份文件都带 .bak-$stamp 后缀，确认没问题可以删掉。" -ForegroundColor DarkGray }
