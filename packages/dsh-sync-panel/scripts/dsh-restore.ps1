# dsh-restore.ps1 -- 在另一台电脑上还原 dsh-pack.ps1 打出的 zip
#
# 按 zip 里实际存在的内容决定做什么（打包时的 -Include 选择）。
# 可以再用 -Apply 收窄（逗号分隔，默认按 zip 内容全做）：
#   local-plugins / market-plugins / plugin-configs / dsh-config / plugin-switches / presets
#
# 做的事：
#   1. 插件源码 -> -PluginsRoot（或打包机原路径存在时原地更新）
#   2. 按本机路径重写 profile/package.json 里的 link: 依赖
#   3. 覆盖 cordis.patch.yml / pnpm-lock.yaml / pnpm-workspace.yaml（原文件先备份 *.bak-时间戳）
#   4. 只带开关时：把 switch-state.json 合并进现有 cordis.patch.yml，其它配置不动
#   5. 用 DSH 自带的 pnpm 跑 install 重建 node_modules
#   6. 逐文件核对 SHA256
#
# 用法：
#   powershell -NoProfile -ExecutionPolicy Bypass -File dsh-restore.ps1 -Zip .\dsh-sync-20261114-1950.zip
#   ... -SkipInstall   不装依赖
#   ... -Apply plugin-switches   只应用开关
#   ... -PluginsRoot "D:\dsh-sync\plugins"

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Zip,
  [string]$ProfileDir = "$env:USERPROFILE\.dsh\profiles\desktop",
  [string]$PluginsRoot = "$env:USERPROFILE\Documents\dsh-sync\plugins",
  [string[]]$Apply = @(),
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

$known = @('local-plugins', 'market-plugins', 'plugin-configs', 'dsh-config', 'plugin-switches', 'presets')
# powershell.exe -File 传进来的 "-Apply a,b" 是一个字符串，这里再按逗号拆一次
$Apply = @($Apply | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim().ToLower() } | Where-Object { $_ -ne '' } | Select-Object -Unique)
foreach ($item in $Apply) {
  if ($known -notcontains $item) { throw "未知的 -Apply 类别：$item（可选：$($known -join ', ')）" }
}
$applySet = @{}
foreach ($item in $Apply) { $applySet[$item] = $true }
# -Apply 为空 = 按 zip 内容全做
function Allow([string]$name) {
  if ($applySet.Count -eq 0) { return $true }
  return $applySet.ContainsKey($name)
}

$stage = Join-Path $env:TEMP "dsh-restore-$stamp"
Expand-Archive -LiteralPath $Zip -DestinationPath $stage -Force
$manifestPath = Join-Path $stage 'manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath)) { throw 'zip 里没有 manifest.json，可能不是 dsh-pack 打的包' }
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding utf8 | ConvertFrom-Json

$selection = @()
if ($manifest.selection) { $selection = @($manifest.selection) }
Write-Host "来源：$($manifest.machine) / $($manifest.createdAt)" -ForegroundColor Cyan
Write-Host "包内类别：$($selection -join ', ')" -ForegroundColor Cyan
if ($manifest.dshAsarTime) { Write-Host "打包机的 DSH 本体：$($manifest.dshAsarTime)" -ForegroundColor DarkGray }

$hashMismatch = 0
$hashChecked = 0
$linkMap = @{}

# ---------- 1. 插件源码 ----------
if ((Test-Path -LiteralPath (Join-Path $stage 'plugins')) -and (Allow 'local-plugins')) {
  New-Item -ItemType Directory -Force -Path $PluginsRoot | Out-Null
  foreach ($plugin in $manifest.plugins) {
    $src = Join-Path (Join-Path $stage 'plugins') $plugin.dirName
    if (-not (Test-Path -LiteralPath $src)) { continue }
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
}

# ---------- 2. 重写 profile/package.json（只更新 link 路径，保留本机其它依赖）----------
$profilePkgPath = Join-Path $ProfileDir 'package.json'
$packedPkgPath = Join-Path $stage 'package.json'
$bundleAdds = @()

if ((Test-Path -LiteralPath $packedPkgPath) -and (Allow 'market-plugins')) {
  $backup = "$profilePkgPath.bak-$stamp"
  Copy-Item -LiteralPath $profilePkgPath -Destination $backup -Force
  Write-Host "  已备份原 package.json -> $backup" -ForegroundColor DarkGray
  Copy-Item -LiteralPath $packedPkgPath -Destination $profilePkgPath -Force
  Write-Host '  package.json 已按包内版本覆盖（市场插件清单）' -ForegroundColor Green
}

$pkg = Get-Content -LiteralPath $profilePkgPath -Raw -Encoding utf8 | ConvertFrom-Json
foreach ($name in $linkMap.Keys) {
  $pkg.dependencies | Add-Member -NotePropertyName $name -NotePropertyValue ("link:" + $linkMap[$name]) -Force
  if ($pkg.dsh.profile.bundles -notcontains $name) { $bundleAdds += $name; $pkg.dsh.profile.bundles += $name }
}
if ($linkMap.Count -gt 0) {
  $pkg | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $profilePkgPath -Encoding utf8 -NoNewline
  Write-Host "  已按本机路径改写 $($linkMap.Count) 个 link: 依赖" -ForegroundColor Green
  if ($bundleAdds.Count -gt 0) { Write-Host "  已补进 bundles：$($bundleAdds -join '、')" -ForegroundColor Green }
}

# ---------- 3. 其它整份配置文件 ----------
foreach ($f in $manifest.profileFiles) {
  if ($f.name -eq 'package.json') { continue }
  # cordis.patch.yml 只在勾了 dsh-config 时才整份覆盖
  if ($f.name -eq 'cordis.patch.yml' -and -not (Allow 'dsh-config')) { continue }
  if ($f.name -ne 'cordis.patch.yml' -and -not (Allow 'market-plugins')) { continue }
  $src = Join-Path $stage $f.name
  if (-not (Test-Path -LiteralPath $src)) { continue }
  $dst = Join-Path $ProfileDir $f.name
  if (Test-Path -LiteralPath $dst) { Copy-Item -LiteralPath $dst -Destination "$dst.bak-$stamp" -Force }
  Copy-Item -LiteralPath $src -Destination $dst -Force
  Write-Host "  配置 $($f.name) 已更新" -ForegroundColor Green
}

# ---------- 4. 只合并插件开关 ----------
$switchPath = Join-Path $stage 'switch-state.json'
if ((Test-Path -LiteralPath $switchPath) -and (Allow 'plugin-switches') -and -not (Allow 'dsh-config')) {
  $switchFile = Get-Content -LiteralPath $switchPath -Raw -Encoding utf8 | ConvertFrom-Json
  $patchPath = Join-Path $ProfileDir 'cordis.patch.yml'
  $lines = @()
  if (Test-Path -LiteralPath $patchPath) {
    Copy-Item -LiteralPath $patchPath -Destination "$patchPath.bak-$stamp" -Force
    $lines = @(Get-Content -LiteralPath $patchPath -Encoding utf8)
  }
  # 切成条目块，逐块找 id，改写条目级 disabled
  $blocks = New-Object System.Collections.Generic.List[object]
  $current = New-Object System.Collections.Generic.List[string]
  foreach ($line in $lines) {
    if ($line -match '^- ' -and $current.Count -gt 0) { $blocks.Add($current.ToArray()); $current.Clear() }
    $current.Add($line)
  }
  if ($current.Count -gt 0) { $blocks.Add($current.ToArray()) }

  $changed = 0
  $touched = @()
  $out = New-Object System.Collections.Generic.List[string]
  foreach ($block in $blocks) {
    $id = ''
    if ($block.Count -gt 0 -and $block[0] -match '^- id:\s*(\S+)') { $id = $matches[1].Trim("'", '"') }
    $want = $switchFile.switches.$id
    if ($id -ne '' -and $null -ne $want) {
      $target = if ($want -eq $true) { 'true' } else { 'false' }
      $found = $false
      $rewritten = @()
      foreach ($line in $block) {
        if (-not $found -and $line -match '^\s{2}disabled:\s*(true|false)\s*$') {
          if ($matches[1] -ne $target) { $changed++ }
          $rewritten += "  disabled: $target"
          $found = $true
          continue
        }
        $rewritten += $line
      }
      if (-not $found -and $target -eq 'true') {
        # 原来没有 disabled 行，需要显式关闭：插在 id 行之后
        $rewritten = @($block[0], "  disabled: true") + @($block | Select-Object -Skip 1)
        $changed++
      }
      if (-not $found -and $target -eq 'false') {
        # 默认就是启用，无需写行
      }
      $touched += $id
      foreach ($line in $rewritten) { $out.Add($line) }
    } else {
      foreach ($line in $block) { $out.Add($line) }
    }
  }
  Set-Content -LiteralPath $patchPath -Value ($out -join "`n") -Encoding utf8
  Write-Host "  已合并插件开关：$($touched.Count) 个条目，其中变更有 $changed 个" -ForegroundColor Green
}

# ---------- 5. 只合并插件参数 ----------
$configPath = Join-Path $stage 'plugin-configs.yml'
if ((Test-Path -LiteralPath $configPath) -and (Allow 'plugin-configs') -and -not (Allow 'dsh-config')) {
  $patchPath = Join-Path $ProfileDir 'cordis.patch.yml'
  $lines = @()
  if (Test-Path -LiteralPath $patchPath) {
    Copy-Item -LiteralPath $patchPath -Destination "$patchPath.bak-$stamp" -Force
    $lines = @(Get-Content -LiteralPath $patchPath -Encoding utf8)
  }
  # 用包内的参数块替换同 id 条目的 config，其它字段（含 disabled）保留本机值
  $newBlocks = New-Object System.Collections.Generic.List[object]
  $current = New-Object System.Collections.Generic.List[string]
  foreach ($line in (Get-Content -LiteralPath $configPath -Encoding utf8)) {
    if ($line -match '^- ' -and $current.Count -gt 0) { $newBlocks.Add($current.ToArray()); $current.Clear() }
    $current.Add($line)
  }
  if ($current.Count -gt 0) { $newBlocks.Add($current.ToArray()) }

  $incoming = @{}
  foreach ($block in $newBlocks) {
    $id = ''
    if ($block.Count -gt 0 -and $block[0] -match '^- id:\s*(\S+)') { $id = $matches[1].Trim("'", '"') }
    if ($id -ne '') { $incoming[$id] = $block }
  }

  $oldBlocks = New-Object System.Collections.Generic.List[object]
  $current = New-Object System.Collections.Generic.List[string]
  foreach ($line in $lines) {
    if ($line -match '^- ' -and $current.Count -gt 0) { $oldBlocks.Add($current.ToArray()); $current.Clear() }
    $current.Add($line)
  }
  if ($current.Count -gt 0) { $oldBlocks.Add($current.ToArray()) }

  $out = New-Object System.Collections.Generic.List[string]
  $replaced = @()
  foreach ($block in $oldBlocks) {
    $id = ''
    if ($block.Count -gt 0 -and $block[0] -match '^- id:\s*(\S+)') { $id = $matches[1].Trim("'", '"') }
    if ($id -ne '' -and $incoming.ContainsKey($id)) {
      # 保留本机条目的名字与 disabled，仅用包内块的 config 段
      $keep = @()
      foreach ($line in $block) {
        if ($line -match '^\s{2}(name|disabled):') { $keep += $line }
      }
      $cfg = @()
      $inCfg = $false
      foreach ($line in $incoming[$id]) {
        if ($line -match '^\s{2}config:\s*$') { $inCfg = $true; $cfg += $line; continue }
        if ($inCfg -and $line -match '^\s{2}\S') { $inCfg = $false }
        if ($inCfg) { $cfg += $line }
      }
      $merged = @($block[0]) + $keep + $cfg
      foreach ($line in $merged) { $out.Add($line) }
      $replaced += $id
    } else {
      foreach ($line in $block) { $out.Add($line) }
    }
  }
  Set-Content -LiteralPath $patchPath -Value ($out -join "`n") -Encoding utf8
  Write-Host "  已合并插件参数：$($replaced.Count) 个条目（开关保持本机值）" -ForegroundColor Green
}

# ---------- 6. agent 预设 ----------
$presetSrc = Join-Path $stage 'agent-presets'
if ((Test-Path -LiteralPath $presetSrc) -and (Allow 'presets')) {
  $presetDst = Join-Path $env:USERPROFILE '.dsh\.agent-presets'
  New-Item -ItemType Directory -Force -Path $presetDst | Out-Null
  Copy-Item -Path (Join-Path $presetSrc '*') -Destination $presetDst -Recurse -Force
  Write-Host '  .agent-presets 已更新' -ForegroundColor Green
}

# ---------- 7. 装依赖 ----------
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
