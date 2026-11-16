/**
 * dsh-sync-panel — 在 DSH 设置页里一键打包 / 一键还原「插件 + 配置」（Host 半）。
 *
 * 为什么做：把插件和 profile 配置同步到另一台电脑，原先要手工改 link 路径、
 * 手工装依赖；两个 PowerShell 脚本已经验证过，这里把它们接到设置页按钮上。
 *
 * 本插件不重新实现打包逻辑：直接调用同目录 scripts/ 下的两个脚本，
 * 保证「命令行」和「设置页」走的是同一条路径，不会出现两套行为。
 *
 * @module dsh-sync-panel
 */
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { readdir, stat, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-sync-panel'

export const inject = ['tools', 'webServer']

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** 可勾选的打包类别；顺序就是设置页里的显示顺序。 */
export const CATEGORIES = [
  { id: 'local-plugins', label: '本地插件', hint: 'profile 里 link: 指向的插件源码（@local/* 等）' },
  { id: 'market-plugins', label: '插件市场插件', hint: 'package.json + pnpm-lock.yaml，靠目标机重装' },
  { id: 'plugin-configs', label: '插件配置', hint: '各插件自己的参数（config 段），开关保持本机值' },
  { id: 'dsh-config', label: 'DSH 配置', hint: '整份 cordis.patch.yml，含模型、UI、插件开关与参数' },
  { id: 'plugin-switches', label: '插件开关', hint: '只带每条目的 disabled，合并时不动其它配置' },
  { id: 'presets', label: 'Agent 预设', hint: '.agent-presets 里的自定义预设' },
]

const CATEGORY_IDS = CATEGORIES.map(item => item.id)

const DEFAULTS = {
  /* profile 目录：只读它的 package.json / cordis.patch.yml 等 */
  profileDir: path.join(os.homedir(), '.dsh', 'profiles', 'desktop'),
  /* 打包产物落在哪；还原时也从这里挑 zip */
  syncDir: path.join(os.homedir(), 'Documents', 'dsh-sync'),
  /* 另一台机器上插件的落点（还原时若原路径不存在就用它） */
  pluginsRoot: path.join(os.homedir(), 'Documents', 'dsh-sync', 'plugins'),
  /* 脚本目录，默认用本插件自带的那两个 */
  scriptDir: path.join(HERE, 'scripts'),
  /* 默认勾选的打包类别 */
  include: ['local-plugins', 'market-plugins', 'plugin-configs', 'dsh-config', 'plugin-switches'],
  /* 还原时是否跑 pnpm install */
  installDeps: true,
  /* 强制把插件放到 pluginsRoot（即使打包机的原路径在本机也存在） */
  forcePluginsRoot: false,
  /* 单个任务超时（毫秒） */
  timeoutMs: 10 * 60 * 1000,
  /* 日志回传上限 */
  maxLogChars: 20000,
}

function normalizeCategories(value, field) {
  if (value === null || typeof value === 'undefined') return undefined
  if (!Array.isArray(value)) throw new TypeError(`dsh-sync-panel config.${field} 必须是数组`)
  const seen = []
  for (const item of value) {
    if (typeof item !== 'string') throw new TypeError(`dsh-sync-panel config.${field} 只能包含字符串`)
    const id = item.trim().toLowerCase()
    if (id === '') continue
    if (!CATEGORY_IDS.includes(id)) {
      throw new TypeError(`dsh-sync-panel config.${field} 里有未知类别：${id}（可选：${CATEGORY_IDS.join(', ')}）`)
    }
    if (!seen.includes(id)) seen.push(id)
  }
  return seen
}

function normalizeConfig(raw) {
  if (raw === null || typeof raw === 'undefined') return { ...DEFAULTS }
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('dsh-sync-panel config 必须是对象')
  const config = { ...DEFAULTS, ...raw }
  for (const field of ['profileDir', 'syncDir', 'pluginsRoot', 'scriptDir']) {
    if (typeof config[field] !== 'string' || config[field].trim() === '') {
      throw new TypeError(`dsh-sync-panel config.${field} 必须是非空字符串`)
    }
    config[field] = path.resolve(config[field])
  }
  for (const field of ['installDeps', 'forcePluginsRoot']) {
    if (typeof config[field] !== 'boolean') throw new TypeError(`dsh-sync-panel config.${field} 必须是布尔值`)
  }
  for (const field of ['timeoutMs', 'maxLogChars']) {
    if (typeof config[field] !== 'number' || !Number.isFinite(config[field]) || config[field] <= 0) {
      throw new TypeError(`dsh-sync-panel config.${field} 必须是正数`)
    }
  }
  /* 旧配置里的 includePresets 仍兼容：true 就等于把 presets 加进 include。 */
  let include = normalizeCategories(config.include, 'include') ?? [...DEFAULTS.include]
  if (config.includePresets === true && !include.includes('presets')) include = [...include, 'presets']
  if (include.length === 0) throw new TypeError('dsh-sync-panel config.include 不能为空')
  config.include = include
  delete config.includePresets
  return config
}

function log(...args) {
  console.error('[dsh-sync-panel]', ...args)
}

function textOf(error) {
  if (error === null || typeof error === 'undefined') return ''
  if (typeof error === 'string') return error
  if (typeof error.message === 'string') return error.message
  return String(error)
}

function clip(text, max) {
  const value = String(text ?? '')
  if (value.length <= max) return value
  return `…（前 ${max} 字已截断）\n${value.slice(-max)}`
}

/** 把用户勾选的类别收敛成脚本认识的集合。 */
function pickCategories(value, fallback) {
  const normalized = normalizeCategories(value, 'include')
  if (normalized === undefined) return [...fallback]
  if (normalized.length === 0) throw new TypeError('至少要勾选一项')
  return normalized
}

/** 列出现成的同步 zip（新的在前）。 */
async function listArchives(syncDir) {
  let names = []
  try {
    names = await readdir(syncDir)
  } catch {
    return []
  }
  const rows = []
  for (const entry of names) {
    if (!/^dsh-sync-.*\.zip$/i.test(entry)) continue
    const full = path.join(syncDir, entry)
    try {
      const info = await stat(full)
      rows.push({
        name: entry,
        path: full,
        sizeMB: Math.round((info.size / 1024 / 1024) * 100) / 100,
        mtime: info.mtimeMs,
      })
    } catch {
      /* 读不到就跳过 */
    }
  }
  rows.sort((a, b) => b.mtime - a.mtime)
  return rows
}

/**
 * 跑一个脚本，返回 { ok, code, output }。
 *
 * 用 execFile 传数组参数，避免路径里有空格/中文时被拆词。
 * Windows PowerShell 5.1 按控制台代码页（简中为 GBK）写 stdout，
 * 所以先按 UTF-8 严格解码，失败再退回 GBK，日志里才不会出现乱码。
 */
function decodeOutput(buffer) {
  if (typeof buffer !== 'string') {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    } catch {
      /* 不是合法 UTF-8，落到下面 */
    }
    try {
      return new TextDecoder('gbk').decode(buffer)
    } catch {
      return buffer.toString('utf8')
    }
  }
  return buffer
}

function runPowerShell(scriptPath, args, timeoutMs) {
  return new Promise(resolve => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args],
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, encoding: 'buffer' },
      (error, stdout, stderr) => {
        const output = [decodeOutput(stdout), decodeOutput(stderr)]
          .filter(part => typeof part === 'string' && part.trim() !== '')
          .join('\n')
        resolve({
          ok: error === null,
          code: typeof error?.code === 'number' ? error.code : 0,
          killed: error?.killed === true,
          output,
        })
      },
    )
  })
}

export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)
  const deps = { ctx, config }
  /* 同一时间只允许一个任务：打包/还原都会写文件，串行更安全。 */
  let running = null

  async function guard(label, task) {
    if (running !== null) return { ok: false, busy: true, message: `正在执行「${running}」，等它结束再试。` }
    running = label
    try {
      return await task()
    } finally {
      running = null
    }
  }

  async function status() {
    return {
      ok: true,
      profileDir: config.profileDir,
      syncDir: config.syncDir,
      pluginsRoot: config.pluginsRoot,
      scriptDir: config.scriptDir,
      include: config.include,
      categories: CATEGORIES,
      installDeps: config.installDeps,
      forcePluginsRoot: config.forcePluginsRoot,
      busy: running,
      archives: await listArchives(config.syncDir),
    }
  }

  async function pack(options = {}) {
    const include = pickCategories(options.include, config.include)
    await mkdir(config.syncDir, { recursive: true })
    const args = ['-ProfileDir', config.profileDir, '-OutDir', config.syncDir, '-Include', include.join(',')]
    const result = await runPowerShell(path.join(config.scriptDir, 'dsh-pack.ps1'), args, config.timeoutMs)
    const archives = await listArchives(config.syncDir)
    const latest = archives[0]
    return {
      ok: result.ok,
      action: 'pack',
      zip: latest?.path,
      sizeMB: latest?.sizeMB,
      include,
      log: clip(result.output, config.maxLogChars),
      message: result.ok
        ? `打包完成：${latest?.name ?? '(未找到产物)'}（${latest?.sizeMB ?? '?'} MB，${include.length} 类）`
        : '打包失败，看日志。',
    }
  }

  async function restore(options = {}) {
    const zip = typeof options.zip === 'string' && options.zip !== '' ? options.zip : ''
    if (zip === '') return { ok: false, action: 'restore', message: '请先选一个 zip。' }
    let info
    try {
      info = await stat(zip)
    } catch {
      return { ok: false, action: 'restore', message: `找不到这个 zip：${zip}` }
    }
    if (!info.isFile()) return { ok: false, action: 'restore', message: '选中的不是文件。' }
    const installDeps = options.installDeps === undefined ? config.installDeps : options.installDeps === true
    const forcePluginsRoot = options.forcePluginsRoot === undefined
      ? config.forcePluginsRoot
      : options.forcePluginsRoot === true
    const apply = normalizeCategories(options.apply, 'apply')
    const args = [
      '-Zip', zip,
      '-ProfileDir', config.profileDir,
      '-PluginsRoot', config.pluginsRoot,
      '-KeepBackup',
    ]
    if (apply !== undefined && apply.length > 0) args.push('-Apply', apply.join(','))
    if (forcePluginsRoot) args.push('-ForcePluginsRoot')
    if (!installDeps) args.push('-SkipInstall')
    const result = await runPowerShell(path.join(config.scriptDir, 'dsh-restore.ps1'), args, config.timeoutMs)
    return {
      ok: result.ok,
      action: 'restore',
      zip,
      installDeps,
      apply: apply ?? [],
      needsRestart: result.ok,
      log: clip(result.output, config.maxLogChars),
      message: result.ok ? '还原完成，重启 DSH 后生效。' : '还原失败，看日志。',
    }
  }

  /* ---------- HTTP 路由：Client 半的设置页调这些 ---------- */
  const sendJson = (res, status, value) => {
    const body = JSON.stringify(value)
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(body),
      'cache-control': 'no-store',
    })
    res.end(body)
  }

  const readJsonBody = async (req) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    if (chunks.length === 0) return {}
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      return null
    }
  }

  const routes = [
    {
      path: '/dsh-sync/status',
      handler: async (req, res) => {
        /* 把请求体读掉，避免连接挂着不结束（Client 用 POST 发空体）。 */
        await readJsonBody(req).catch(() => null)
        try {
          sendJson(res, 200, await status())
        } catch (error) {
          sendJson(res, 500, { ok: false, message: textOf(error) })
        }
      },
    },
    {
      path: '/dsh-sync/pack',
      handler: async (req, res) => {
        const body = await readJsonBody(req)
        if (body === null) {
          sendJson(res, 400, { ok: false, message: '请求体不是合法 JSON' })
          return
        }
        try {
          const outcome = await guard('打包', () => pack(body))
          sendJson(res, 200, outcome)
        } catch (error) {
          sendJson(res, 500, { ok: false, message: textOf(error) })
        }
      },
    },
    {
      path: '/dsh-sync/restore',
      handler: async (req, res) => {
        const body = await readJsonBody(req)
        if (body === null) {
          sendJson(res, 400, { ok: false, message: '请求体不是合法 JSON' })
          return
        }
        try {
          const outcome = await guard('还原', () => restore(body))
          sendJson(res, 200, outcome)
        } catch (error) {
          sendJson(res, 500, { ok: false, message: textOf(error) })
        }
      },
    },
  ]

  for (const route of routes) {
    ctx.effect(
      () => ctx.webServer.register({ kind: 'exact', path: route.path, handler: route.handler }),
      `dsh-sync-panel: ${route.path}`,
    )
  }

  /* ---------- 工具：让 agent 也能触发同一套动作 ---------- */
  ctx.effect(() =>
    ctx.tools.register({
      name: 'dsh_sync',
      description:
        '打包/还原 DSH 的本地插件与 profile 配置（跨电脑同步）。可按类别挑选：local-plugins / market-plugins / plugin-configs / dsh-config / plugin-switches / presets。status 看目录与现成的 zip，pack 生成 zip，restore 用指定 zip 还原（会改 profile，原文件备份成 .bak-时间戳）。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['status', 'pack', 'restore'] },
          zip: { type: 'string', description: 'restore 用的 zip 完整路径' },
          include: {
            type: 'array',
            items: {
              type: 'string',
              enum: CATEGORY_IDS,
            },
            description: 'pack 时带哪些类别；省略则按插件配置的默认集合。',
          },
          apply: {
            type: 'array',
            items: { type: 'string', enum: CATEGORY_IDS },
            description: 'restore 时只应用哪些类别；省略则按包内实际内容全做。',
          },
          installDeps: { type: 'boolean', description: 'restore 时是否跑 pnpm install' },
        },
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            action: { type: 'string' },
            message: { type: 'string' },
            zip: { type: 'string' },
            sizeMB: { type: 'number' },
            log: { type: 'string' },
          },
          required: ['ok', 'message'],
          additionalProperties: false,
        },
        render: (_args, value) => [{ type: 'text', text: value.message }],
      },
      async execute(args) {
        const action = args?.action ?? 'status'
        if (action === 'status') {
          const info = await status()
          const lines = [
            `profile：${info.profileDir}`,
            `打包目录：${info.syncDir}`,
            `默认类别：${info.include.join(', ')}`,
            `现成 zip：${info.archives.length} 个${info.archives.length === 0 ? '' : `（最新 ${info.archives[0].name}，${info.archives[0].sizeMB} MB）`}`,
          ]
          if (info.busy !== null) lines.push(`正在执行：${info.busy}`)
          return { ok: true, action, message: lines.join('\n') }
        }
        const outcome = await guard(action === 'pack' ? '打包' : '还原', () =>
          action === 'pack'
            ? pack({ include: args?.include })
            : restore({ zip: args?.zip, installDeps: args?.installDeps, apply: args?.apply }),
        )
        return {
          ok: outcome.ok === true,
          action,
          zip: outcome.zip,
          sizeMB: outcome.sizeMB,
          log: outcome.log,
          message: outcome.message ?? (outcome.ok ? '完成' : '失败'),
        }
      },
    }),
  )

  log(`已就绪：profile=${config.profileDir}，打包目录=${config.syncDir}，默认类别=${config.include.join(',')}`)
}
