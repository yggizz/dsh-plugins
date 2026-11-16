# dsh-pack.ps1 -- 把「本地插件源码 + profile 配置」打成一个可搬到另一台电脑的 zip
#
# 可以按类别挑选要带走的內容（-Include，逗号分隔；默认全带）：
#   local-plugins     本地插件源码（profile package.json 里所有 link: 指向的目录）
#   market-plugins    市场插件的「清单与锁定版本」：package.json / pnpm-lock.yaml / pnpm-workspace.yaml
#                     （源码不打包，靠目标机 pnpm install 按锁版本重装）
#   plugin-configs    各插件自己的参数（cordis.patch.yml 里每个条目的 config 段）
#   dsh-config        DSH 核心配置整份 cordis.patch.yml（勾了就整份覆盖，包含插件开关与参数）
#   plugin-switches   只带插件开关状态（每条目的 disabled）
#   presets           ~/.dsh/.agent-presets 自定义 agent 预设
#
# 不打包：sessions、session-trash、attachments、node_modules、插件运行时缓存、任何凭据文件。
#
# 用法（PowerShell 7 和 Windows PowerShell 5.1 都可以）：
#   powershell -NoProfile -ExecutionPolicy Bypass -File dsh-pack.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File dsh-pack.ps1 -Include local-plugins,plugin-switches
#   powershell -NoProfile -ExecutionPolicy Bypass -File dsh-pack.ps1 -ProfileDir "C:\Users\xxx\.dsh\profiles\desktop" -OutDir "D:\传递"

[CmdletBinding()]
param(
  [string]$ProfileDir = "$env:USERPROFILE\.dsh\profiles\desktop",
  [string]$OutDir = "$env:USERPROFILE\Documents\dsh-sync",
  [string[]]$Include = @('local-plugins', 'market-plugins', 'plugin-configs', 'dsh-config', 'plugin-switches'),
  [switch]$IncludePresets
)

$ErrorActionPreference = 'Stop'

$known = @('local-plugins', 'market-plugins', 'plugin-configs', 'dsh-config', 'plugin-switches', 'presets')
if ($IncludePresets) { $Include += 'presets' }
# powershell.exe -File 传进来的 "-Include a,b" 是一个字符串，这里再按逗号拆一次
$Include = @($Include | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim().ToLower() } | Where-Object { $_ -ne '' } | Select-Object -Unique)
foreach ($item in $Include) {
  if ($known -notcontains $item) { throw "未知的 -Include 类别：$item（可选：$($known -join ', ')）" }
}
if ($Include.Count -eq 0) { throw '-Include 不能为空' }

$selected = @{}
foreach ($item in $Include) { $selected[$item] = $true }
function Wanted([string]$name) { return $selected.ContainsKey($name) }

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
Write-Host "选择：$($Include -join ', ')" -ForegroundColor Cyan
$profilePkg = Get-Content -LiteralPath (Join-Path $ProfileDir 'package.json') -Raw -Encoding utf8 | ConvertFrom-Json
$localDeps = @()
foreach ($prop in $profilePkg.dependencies.PSObject.Properties) {
  if ([string]$prop.Value -like 'link:*') {
    $localDeps += [pscustomobject]@{ name = $prop.Name; target = ([string]$prop.Value -replace '^link:', '') }
  }
}

New-Item -ItemType Directory -Force -Path $stage | Out-Null
$manifestPlugins = @()

# ---------- 1. 本地插件源码 ----------
if (Wanted 'local-plugins') {
  if ($localDeps.Count -eq 0) { throw 'profile 里没有任何 link: 本地插件，没什么可打包的' }
  $pluginsStage = Join-Path $stage 'plugins'
  New-Item -ItemType Directory -Force -Path $pluginsStage | Out-Null
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
}

# ---------- 2. 市场插件清单与锁定版本 ----------
$profileFiles = @()
if (Wanted 'market-plugins') {
  foreach ($name in @('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml')) {
    $p = Join-Path $ProfileDir $name
    if (-not (Test-Path -LiteralPath $p)) { continue }
    Copy-Item -LiteralPath $p -Destination (Join-Path $stage $name) -Force
    $profileFiles += [pscustomobject]@{
      name   = $name
      size   = (Get-Item -LiteralPath $p).Length
      sha256 = (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLower()
    }
    Write-Host "  清单 $name" -ForegroundColor Green
  }
  $p = Join-Path $ProfileDir 'cordis.yml'
  if (Test-Path -LiteralPath $p) { Copy-Item -LiteralPath $p -Destination (Join-Path $stage 'cordis.yml') -Force }
}

# ---------- 3. cordis.patch.yml：整份 / 只参数 / 只开关 ----------
$patchPath = Join-Path $ProfileDir 'cordis.patch.yml'
$wantFull = Wanted 'dsh-config'
$wantConfigs = Wanted 'plugin-configs'
$wantSwitches = Wanted 'plugin-switches'

if (($wantFull -or $wantConfigs -or $wantSwitches) -and (Test-Path -LiteralPath $patchPath)) {
  if ($wantFull) {
    Copy-Item -LiteralPath $patchPath -Destination (Join-Path $stage 'cordis.patch.yml') -Force
    $profileFiles += [pscustomobject]@{
      name   = 'cordis.patch.yml'
      size   = (Get-Item -LiteralPath $patchPath).Length
      sha256 = (Get-FileHash -LiteralPath $patchPath -Algorithm SHA256).Hash.ToLower()
    }
    Write-Host '  配置 cordis.patch.yml（整份）' -ForegroundColor Green
  }

  # 按顶层条目切块：顶层条目的行首是 "- "
  $lines = Get-Content -LiteralPath $patchPath -Encoding utf8
  $blocks = New-Object System.Collections.Generic.List[object]
  $current = New-Object System.Collections.Generic.List[string]
  foreach ($line in $lines) {
    if ($line -match '^- ' -and $current.Count -gt 0) {
      $blocks.Add($current.ToArray()); $current.Clear()
    }
    $current.Add($line)
  }
  if ($current.Count -gt 0) { $blocks.Add($current.ToArray()) }

  $entryIds = @()
  $switchMap = [ordered]@{}
  $configBlocks = New-Object System.Collections.Generic.List[string]
  foreach ($block in $blocks) {
    $id = ''
    if ($block.Count -gt 0 -and $block[0] -match '^- id:\s*(\S+)') { $id = $matches[1].Trim("'", '"') }
    if ($id -eq '') { continue }
    $entryIds += $id

    # 开关：只看缩进 2 的 disabled（条目级），子条目的 disabled 不算
    $disabled = $false
    foreach ($line in $block) {
      if ($line -match '^\s{2}disabled:\s*(true|false)\s*$') {
        $disabled = ($matches[1] -eq 'true')
        break
      }
    }
    $switchMap[$id] = $disabled

    if ($wantConfigs) {
      # 参数块：整块保留，但去掉条目级 disabled 行（开关单独存）
      $kept = @()
      foreach ($line in $block) {
        if ($line -match '^\s{2}disabled:\s*(true|false)\s*$') { continue }
        $kept += $line
      }
      $configBlocks.Add(($kept -join "`n"))
    }
  }

  if ($wantConfigs -and -not $wantFull) {
    $trimmed = "# 由 dsh-pack 导出：只含各插件参数，不含插件开关`n" + ($configBlocks -join "`n")
    Set-Content -LiteralPath (Join-Path $stage 'plugin-configs.yml') -Value $trimmed -Encoding utf8
    Write-Host "  配置 plugin-configs.yml（$($entryIds.Count) 个条目的参数）" -ForegroundColor Green
  }
  if ($wantSwitches) {
    $switchJson = [ordered]@{
      exportedAt = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
      machine    = $env:COMPUTERNAME
      count      = $entryIds.Count
      switches   = $switchMap
    }
    $switchJson | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $stage 'switch-state.json') -Encoding utf8
    $off = @($switchMap.Keys | Where-Object { $switchMap[$_] -eq $true })
    Write-Host "  开关 switch-state.json（$($entryIds.Count) 条，其中关闭 $($off.Count) 个）" -ForegroundColor Green
  }
}

# ---------- 4. agent 预设 ----------
if (Wanted 'presets') {
  $presetRoot = Join-Path $env:USERPROFILE '.dsh\.agent-presets'
  if (Test-Path -LiteralPath $presetRoot) {
    Copy-Tree -Source $presetRoot -Destination (Join-Path $stage 'agent-presets')
    Write-Host '  已带上 .agent-presets' -ForegroundColor Green
  } else {
    Write-Host '  没有 .agent-presets 目录，跳过' -ForegroundColor Yellow
  }
}

# DSH 本体版本：版本不一致时插件可能装不上，写进清单便于对照
$dshVersion = ''
foreach ($asar in @('D:\Program Files\DSH NEXT\resources\app.asar', 'D:\Program Files\DeepSeek Harness\resources\app.asar')) {
  if (Test-Path -LiteralPath $asar) {
    $dshVersion = "$asar = " + (Get-Item -LiteralPath $asar).LastWriteTime.ToString('yyyy-MM-dd HH:mm')
    break
  }
}

$manifest = [pscustomobject]@{
  format       = 2
  createdAt    = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  machine      = $env:COMPUTERNAME
  user         = $env:USERNAME
  profileDir   = $ProfileDir
  dshAsarTime  = $dshVersion
  selection    = $Include
  plugins      = $manifestPlugins
  profileFiles = $profileFiles
  presets      = [bool](Wanted 'presets')
}
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $stage 'manifest.json') -Encoding utf8

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zipPath -CompressionLevel Optimal

$zipSize = [math]::Round((Get-Item -LiteralPath $zipPath).Length / 1MB, 2)
Remove-Item -LiteralPath $stage -Recurse -Force

Write-Host ''
Write-Host "打包完成：$zipPath（$zipSize MB，$($manifestPlugins.Count) 个插件源码，$($Include -join ' / ')）" -ForegroundColor Cyan
