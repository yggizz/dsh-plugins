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

const DEFAULTS = {
  /* profile 目录：只读它的 package.json / cordis.patch.yml 等 */
  profileDir: path.join(os.homedir(), '.dsh', 'profiles', 'desktop'),
  /* 打包产物落在哪；还原时也从这里挑 zip */
  syncDir: path.join(os.homedir(), 'Documents', 'dsh-sync'),
  /* 另一台机器上插件的落点（还原时若原路径不存在就用它） */
  pluginsRoot: path.join(os.homedir(), 'Documents', 'dsh-sync', 'plugins'),
  /* 脚本目录，默认用本插件自带的那两个 */
  scriptDir: path.join(HERE, 'scripts'),
  /* 打包时是否连 .agent-presets 一起带 */
  includePresets: false,
  /* 还原时是否跑 pnpm install */
  installDeps: true,
  /* 强制把插件放到 pluginsRoot（即使打包机的原路径在本机也存在） */
  forcePluginsRoot: false,
  /* 单个任务超时（毫秒） */
  timeoutMs: 10 * 60 * 1000,
  /* 同时只允许一个任务 */
  maxLogChars: 20000,
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
  for (const field of ['includePresets', 'installDeps', 'forcePluginsRoot']) {
    if (typeof config[field] !== 'boolean') throw new TypeError(`dsh-sync-panel config.${field} 必须是布尔值`)
  }
  for (const field of ['timeoutMs', 'maxLogChars']) {
    if (typeof config[field] !== 'number' || !Number.isFinite(config[field]) || config[field] <= 0) {
      throw new TypeError(`dsh-sync-panel config.${field} 必须是正数`)
    }
  }
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
      includePresets: config.includePresets,
      installDeps: config.installDeps,
      forcePluginsRoot: config.forcePluginsRoot,
      busy: running,
      archives: await listArchives(config.syncDir),
    }
  }

  async function pack(options = {}) {
    const includePresets = options.includePresets === true || (options.includePresets === undefined && config.includePresets)
    await mkdir(config.syncDir, { recursive: true })
    const args = ['-ProfileDir', config.profileDir, '-OutDir', config.syncDir]
    if (includePresets) args.push('-IncludePresets')
    const result = await runPowerShell(path.join(config.scriptDir, 'dsh-pack.ps1'), args, config.timeoutMs)
    const archives = await listArchives(config.syncDir)
    const latest = archives[0]
    return {
      ok: result.ok,
      action: 'pack',
      zip: latest?.path,
      sizeMB: latest?.sizeMB,
      includePresets,
      log: clip(result.output, config.maxLogChars),
      message: result.ok
        ? `打包完成：${latest?.name ?? '(未找到产物)'}（${latest?.sizeMB ?? '?'} MB）`
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
    const args = [
      '-Zip', zip,
      '-ProfileDir', config.profileDir,
      '-PluginsRoot', config.pluginsRoot,
      '-KeepBackup',
    ]
    if (forcePluginsRoot) args.push('-ForcePluginsRoot')
    if (!installDeps) args.push('-SkipInstall')
    const result = await runPowerShell(path.join(config.scriptDir, 'dsh-restore.ps1'), args, config.timeoutMs)
    return {
      ok: result.ok,
      action: 'restore',
      zip,
      installDeps,
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
        '打包/还原 DSH 的本地插件与 profile 配置（跨电脑同步）。status 看目录与现成的 zip，pack 生成 zip，restore 用指定 zip 还原（会改 profile，原文件备份成 .bak-时间戳）。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['status', 'pack', 'restore'] },
          zip: { type: 'string', description: 'restore 用的 zip 完整路径' },
          includePresets: { type: 'boolean', description: 'pack 时是否带上 .agent-presets' },
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
            `现成 zip：${info.archives.length} 个${info.archives.length === 0 ? '' : `（最新 ${info.archives[0].name}，${info.archives[0].sizeMB} MB）`}`,
          ]
          if (info.busy !== null) lines.push(`正在执行：${info.busy}`)
          return { ok: true, action, message: lines.join('\n') }
        }
        const outcome = await guard(action === 'pack' ? '打包' : '还原', () =>
          action === 'pack'
            ? pack({ includePresets: args?.includePresets })
            : restore({ zip: args?.zip, installDeps: args?.installDeps }),
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

  log(`已就绪：profile=${config.profileDir}，打包目录=${config.syncDir}`)
}
