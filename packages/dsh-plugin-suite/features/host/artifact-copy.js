/**
 * Artifact copy — Host half.
 *
 * WHAT THIS DOES
 * The Web page can read clipboard text, but it cannot put a *file* on the
 * operating system clipboard: CF_HDROP on Windows, a POSIX file on macOS, a
 * `text/uri-list` on Linux. Those are native clipboard formats the page has no
 * access to. So the browser half captures the right-clicked file (session id +
 * path) and this half performs the native operation on the machine that owns
 * the file.
 *
 * THREE MODES
 * - `path`     copy the absolute path as text
 * - `relative` copy the session-relative path as text
 * - `file`     put the file itself on the clipboard, so it can be pasted
 *              straight into Explorer, Finder, Slack, WeChat, etc.
 * - `content`  copy a small text file's bytes as text
 *
 * Path resolution: the Session's effective working directory is the base for a
 * relative path, which is what the Client captures. Any existing absolute path
 * is used as-is, because deliverables and temp previews legitimately live
 * outside the workspace.
 *
 * SECURITY
 * This route only answers loopback requests, the same rule the shipped
 * connector routes use: a LAN origin cannot drive the clipboard.
 */

import { promises as fs } from 'node:fs'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { extname, isAbsolute, relative, resolve } from 'node:path'

/** Client-facing routes. */
const PROBE_PATH = '/plugins/artifact-copy/probe'
const COPY_PATH = '/plugins/artifact-copy/copy'

/** Largest file whose bytes are offered as clipboard text. */
const MAX_TEXT_BYTES = 1024 * 1024

/** Largest request body accepted. */
const MAX_BODY_BYTES = 8 * 1024

/** Ceiling for one clipboard helper invocation. */
const PROCESS_TIMEOUT_MS = 8000

/** Extensions whose content is worth copying as text. */
const TEXT_EXTENSIONS = new Set([
  '.md', '.markdown', '.txt', '.text', '.log', '.csv', '.tsv', '.json', '.jsonl',
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts', '.vue', '.svelte',
  '.css', '.scss', '.less', '.html', '.htm', '.xml', '.svg', '.yml', '.yaml',
  '.toml', '.ini', '.cfg', '.conf', '.env', '.py', '.rb', '.php', '.lua', '.pl',
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.psm1', '.bat', '.cmd', '.sql',
  '.go', '.rs', '.java', '.kt', '.kts', '.c', '.h', '.cc', '.cpp', '.hpp', '.cs',
  '.swift', '.dart', '.r', '.jl', '.m', '.mm', '.gradle', '.properties', '.diff',
  '.patch', '.gitignore', '.editorconfig', '.dockerignore',
])

/* ---------------------------------------------------------------- HTTP ---- */

/** Send one JSON answer. */
function sendJson(response, status, value) {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(value))
}

/** Whether a Host header names the socket this request arrived on. */
function hostIsLocal(request) {
  const host = request.headers.host
  if (typeof host !== 'string' || host.trim() === '') return false
  let hostname
  try {
    hostname = new URL(`http://${host}`).hostname
  } catch {
    return false
  }
  const bare = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
  if (bare === 'localhost' || bare === '::1' || bare.endsWith('.localhost')) return true
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(bare)) return true
  const local = request.socket?.localAddress
  return typeof local === 'string' && local !== '' && (local === bare || `[${local}]` === hostname)
}

/** Read a bounded JSON body. */
function readJsonBody(request) {
  return new Promise((accept, reject) => {
    const chunks = []
    let size = 0
    request.on('data', chunk => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body-too-large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        accept(parsed !== null && typeof parsed === 'object' ? parsed : {})
      } catch {
        reject(new Error('bad-json'))
      }
    })
    request.on('error', reject)
  })
}

/* ------------------------------------------------------------ clipboard ---- */

let electronClipboard
let electronResolved = false

/** The Desktop main process clipboard, when this Host runs inside Electron. */
function nativeClipboard() {
  if (electronResolved) return electronClipboard
  electronResolved = true
  try {
    const required = createRequire(import.meta.url)('electron')
    const clipboard = required?.clipboard
    if (clipboard !== undefined && typeof clipboard.writeText === 'function') electronClipboard = clipboard
  } catch {
    // A plain Node Host has no Electron module; the OS helpers below cover it.
  }
  return electronClipboard
}

/** Run one helper process to completion. */
function runProcess(command, args, options = {}) {
  return new Promise((accept, reject) => {
    let child
    try {
      child = spawn(command, args, {
        windowsHide: true,
        stdio: ['pipe', 'ignore', 'pipe'],
        env: { ...process.env, ...options.env },
      })
    } catch (error) {
      reject(error)
      return
    }
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('helper-timeout'))
    }, PROCESS_TIMEOUT_MS)
    timer.unref?.()
    child.stderr?.on('data', chunk => { stderr += String(chunk) })
    child.on('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', code => {
      clearTimeout(timer)
      if (code === 0) accept()
      else reject(new Error(stderr.trim() || `helper-exit-${code}`))
    })
    child.stdin.on('error', () => {})
    child.stdin.end(options.input)
  })
}

/** Put text on the system clipboard; returns which carrier did it. */
async function writeClipboardText(text) {
  const clipboard = nativeClipboard()
  if (clipboard !== undefined) {
    clipboard.writeText(text)
    return 'electron'
  }
  if (process.platform === 'win32') {
    await runProcess('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-STA', '-Command',
      '$ErrorActionPreference="Stop"; Set-Clipboard -Value $env:DSH_ARTIFACT_TEXT',
    ], { env: { DSH_ARTIFACT_TEXT: text } })
    return 'powershell'
  }
  if (process.platform === 'darwin') {
    await runProcess('pbcopy', [], { input: Buffer.from(text, 'utf8') })
    return 'pbcopy'
  }
  await runProcess('xclip', ['-selection', 'clipboard'], { input: Buffer.from(text, 'utf8') })
  return 'xclip'
}

/** Put one or more files on the system clipboard in the native file-list format. */
async function writeClipboardFiles(paths) {
  if (process.platform === 'win32') {
    await runProcess('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-STA', '-Command',
      '$ErrorActionPreference="Stop"; $p = $env:DSH_ARTIFACT_PATHS -split "`n" | Where-Object { $_ -ne "" }; Set-Clipboard -Path $p',
    ], { env: { DSH_ARTIFACT_PATHS: paths.join('\n') } })
    return 'powershell'
  }
  if (process.platform === 'darwin') {
    const statements = paths.map(path => `set the clipboard to (POSIX file ${JSON.stringify(path)})`)
    await runProcess('osascript', statements.flatMap(line => ['-e', line]))
    return 'osascript'
  }
  const uris = paths.map(path => `file://${path.split('/').map(encodeURIComponent).join('/')}`).join('\n')
  await runProcess('xclip', ['-selection', 'clipboard', '-t', 'text/uri-list'], { input: Buffer.from(uris, 'utf8') })
  return 'xclip'
}

/* ----------------------------------------------------------------- paths ---- */

/** The Session's effective working directory, or the Host default. */
function baseDirectory(ctx, sessionId) {
  try {
    const sessions = ctx.get('sessions')
    const workingDirectory = ctx.get('workingDirectory')
    if (typeof sessionId === 'string' && sessionId !== '' && sessions !== undefined && workingDirectory !== undefined) {
      const session = sessions.get?.(sessionId)
      if (session !== undefined) {
        const value = workingDirectory.get(session)
        if (typeof value === 'string' && value !== '') return value
      }
    }
    if (typeof workingDirectory?.defaultDirectory === 'string' && workingDirectory.defaultDirectory !== '') {
      return workingDirectory.defaultDirectory
    }
  } catch {
    // Fall through to the process directory.
  }
  return process.cwd()
}

/** Resolve a captured path against the Session's working directory. */
function absolutePathOf(ctx, sessionId, rawPath) {
  const cleaned = String(rawPath).replace(/\0/gu, '').trim()
  if (cleaned === '') return undefined
  if (isAbsolute(cleaned)) return resolve(cleaned)
  const base = baseDirectory(ctx, sessionId)
  return resolve(base, cleaned)
}

/** File facts the Client needs to decide which actions apply. */
async function probeTarget(ctx, sessionId, rawPath) {
  const absolutePath = absolutePathOf(ctx, sessionId, rawPath)
  if (absolutePath === undefined) return { exists: false }
  let stat
  try {
    stat = await fs.stat(absolutePath)
  } catch {
    return { absolutePath, exists: false }
  }
  const extension = extname(absolutePath).toLowerCase()
  const text = stat.isFile() && stat.size <= MAX_TEXT_BYTES && TEXT_EXTENSIONS.has(extension)
  return {
    absolutePath,
    exists: true,
    directory: stat.isDirectory(),
    size: stat.size,
    kind: stat.isDirectory() ? 'directory' : text ? 'text' : 'binary',
    fromSessionRoot: relative(baseDirectory(ctx, sessionId), absolutePath) || absolutePath,
  }
}

/* ---------------------------------------------------------------- plugin ---- */

/**
 * Register the Host half.
 * @param ctx - the plugin's Cordis context.
 */
export function apply(ctx) {
  ctx.inject(['webServer'], webCtx => {
    ctx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: PROBE_PATH,
      handler: async (request, response) => {
        if (request.method !== 'GET') return sendJson(response, 405, { ok: false, error: 'method-not-allowed' })
        if (!hostIsLocal(request)) return sendJson(response, 403, { ok: false, error: 'host-not-trusted' })
        let params
        try {
          params = new URL(request.url ?? '/', 'http://localhost').searchParams
        } catch {
          return sendJson(response, 400, { ok: false, error: 'bad-request' })
        }
        const sessionId = params.get('sessionId') ?? ''
        const path = params.get('path') ?? ''
        if (path === '') return sendJson(response, 400, { ok: false, error: 'bad-request' })
        try {
          return sendJson(response, 200, { ok: true, ...(await probeTarget(ctx, sessionId, path)) })
        } catch {
          return sendJson(response, 500, { ok: false, error: 'probe-failed' })
        }
      },
    }), 'artifact-copy: probe route')

    ctx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: COPY_PATH,
      handler: async (request, response) => {
        if (request.method !== 'POST') return sendJson(response, 405, { ok: false, error: 'method-not-allowed' })
        if (!hostIsLocal(request)) return sendJson(response, 403, { ok: false, error: 'host-not-trusted' })
        let body
        try {
          body = await readJsonBody(request)
        } catch {
          return sendJson(response, 400, { ok: false, error: 'bad-request' })
        }
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
        const mode = typeof body.mode === 'string' ? body.mode : 'path'
        const rawPath = typeof body.path === 'string' ? body.path : ''
        if (!['path', 'relative', 'file', 'content'].includes(mode)) {
          return sendJson(response, 400, { ok: false, error: 'bad-mode' })
        }
        if (rawPath === '') return sendJson(response, 400, { ok: false, error: 'bad-request' })

        const absolutePath = absolutePathOf(ctx, sessionId, rawPath)
        if (absolutePath === undefined) return sendJson(response, 400, { ok: false, error: 'bad-path' })

        if (mode === 'path' || mode === 'relative') {
          const text = mode === 'path' ? absolutePath : (relative(baseDirectory(ctx, sessionId), absolutePath) || absolutePath)
          try {
            const via = await writeClipboardText(text)
            return sendJson(response, 200, { ok: true, mode, via, absolutePath, text })
          } catch {
            return sendJson(response, 500, { ok: false, error: 'clipboard-failed' })
          }
        }

        let stat
        try {
          stat = await fs.stat(absolutePath)
        } catch {
          return sendJson(response, 404, { ok: false, error: 'missing', absolutePath })
        }

        if (mode === 'file') {
          try {
            const via = await writeClipboardFiles([absolutePath])
            return sendJson(response, 200, { ok: true, mode, via, absolutePath, directory: stat.isDirectory() })
          } catch {
            return sendJson(response, 500, { ok: false, error: 'clipboard-failed', absolutePath })
          }
        }

        // mode === 'content'
        if (!stat.isFile()) return sendJson(response, 400, { ok: false, error: 'not-a-file', absolutePath })
        if (stat.size > MAX_TEXT_BYTES) return sendJson(response, 413, { ok: false, error: 'too-large', absolutePath, size: stat.size })
        let text
        try {
          text = await fs.readFile(absolutePath, 'utf8')
        } catch {
          return sendJson(response, 400, { ok: false, error: 'not-text', absolutePath })
        }
        if (text.includes('\u0000')) return sendJson(response, 400, { ok: false, error: 'not-text', absolutePath })
        try {
          const via = await writeClipboardText(text)
          return sendJson(response, 200, { ok: true, mode, via, absolutePath, bytes: stat.size })
        } catch {
          return sendJson(response, 500, { ok: false, error: 'clipboard-failed', absolutePath })
        }
      },
    }), 'artifact-copy: copy route')
  })
}
