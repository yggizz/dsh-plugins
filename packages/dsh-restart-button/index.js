/**
 * dsh-restart-button — restart this Harness container from the Web sidebar.
 *
 * Host half. Owns the operation and exposes it through two same-origin routes
 * that the Client half calls. The restart is carried out by the Docker daemon:
 *
 *   opencli  `docker.Docker/RestartContainer` on the UGREEN OpenCLI gateway,
 *            i.e. a real `docker restart <container>`. Primary path.
 *   exit     End this process. The container's `restart: unless-stopped`
 *            policy brings it straight back. Fallback when the gateway is
 *            unreachable, unconfigured, or rejected the token.
 *
 * The status route reports a per-process `bootId`, which the Client uses to
 * notice that the container really came back (a container restart may reuse
 * the same PID, so the PID alone is not a reliable signal).
 */
import http from 'node:http'
import https from 'node:https'
import { hostname } from 'node:os'
import { randomUUID } from 'node:crypto'

export const name = 'dsh-restart-button'
export const inject = ['webServer']

/*
 * A workspace-linked bundle resolves bare specifiers from its own directory, so
 * the schema package is treated as optional: when it is absent the row still
 * activates and `apply` validates every setting below by itself.
 */
async function buildConfigSchema() {
  try {
    const module = await import('@deepseek-ai/schemastery')
    const z = module.default ?? module
    if (!z || typeof z.object !== 'function') return undefined
    return z.object({
      /** 'auto' tries OpenCLI first, then falls back to exiting the process. */
      mechanism: z.string().default('auto'),
      endpoint: z.string().default(''),
      accessToken: z.string().default(''),
      socketId: z.string().default('ugreen.dockerserv.internal.grpc'),
      /** Empty means "this container", taken from the kernel hostname. */
      containerId: z.string().default(''),
      rejectUnauthorized: z.boolean().default(false),
      requestTimeoutMs: z.number().default(10000),
      exitDelayMs: z.number().default(700),
      cooldownMs: z.number().default(5000),
    })
  } catch {
    return undefined
  }
}

export const Config = await buildConfigSchema()

const STATUS_PATH = '/api/dsh-restart/status'
const RESTART_PATH = '/api/dsh-restart/restart'
const BODY_LIMIT = 1024

/** One identifier per Node process: the Client polls until it changes. */
const BOOT_ID = randomUUID()
const STARTED_AT = new Date().toISOString()

/* ----------------------------------------------------------- protobuf bits */

function encodeVarint(value) {
  const bytes = []
  let rest = value
  while (rest > 0x7f) {
    bytes.push((rest & 0x7f) | 0x80)
    rest = Math.floor(rest / 128)
  }
  bytes.push(rest)
  return Buffer.from(bytes)
}

/** One `string` field: `RestartContainerRequest { container_id = 1 }`. */
function encodeStringField(fieldNumber, value) {
  const payload = Buffer.from(String(value), 'utf8')
  return Buffer.concat([encodeVarint(fieldNumber * 8 + 2), encodeVarint(payload.length), payload])
}

/* --------------------------------------------------------------- transport */

function requestProtobuf(target, body, token, settings) {
  const send = target.protocol === 'http:' ? http.request : https.request
  return new Promise((resolve, reject) => {
    const request = send(target, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/x-protobuf',
        accept: 'application/x-protobuf',
        'x-opencli-body-format': 'protobuf',
        'content-length': String(body.length),
        'user-agent': 'dsh-restart-button/1.0.0',
      },
      timeout: settings.requestTimeoutMs,
      rejectUnauthorized: settings.rejectUnauthorized,
    }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => resolve({
        status: response.statusCode || 0,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }))
    })
    request.on('timeout', () => request.destroy(new Error('OpenCLI request timed out')))
    request.on('error', reject)
    request.end(body)
  })
}

/** `docker restart <containerId>` through the UGREEN OpenCLI gateway. */
async function restartThroughOpenCLI(settings) {
  const containerId = settings.containerId || hostname()
  const base = settings.endpoint.replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(base)) throw new Error('endpoint must be an absolute http(s) URL')
  const target = new URL(
    `${base}/ugreen/opencli/v1/${encodeURIComponent(settings.socketId)}/docker.Docker/RestartContainer`,
  )
  const response = await requestProtobuf(target, encodeStringField(1, containerId), settings.accessToken, settings)
  const grpcCode = response.headers['x-grpc-code']
  if (response.status === 200 && (grpcCode === undefined || grpcCode === '0')) {
    return { containerId }
  }
  let detail = `OpenCLI HTTP ${response.status}`
  try {
    const parsed = JSON.parse(response.body.toString('utf8'))
    detail = parsed?.message || parsed?.code || detail
  } catch { /* a non-JSON error body keeps the status line */ }
  throw new Error(detail)
}

/* ------------------------------------------------------------- web plumbing */

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload)
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.setHeader('content-length', Buffer.byteLength(body))
  response.end(body)
}

/** Same-origin only: another site must not be able to restart this container. */
function sameOriginRequest(request) {
  const headers = request.headers || {}
  const site = headers['sec-fetch-site']
  if (typeof site === 'string' && site) return site === 'same-origin' || site === 'none'
  const origin = headers.origin
  if (typeof origin !== 'string' || !origin) return true
  try {
    return new URL(origin).host === String(headers.host || '')
  } catch {
    return false
  }
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > BODY_LIMIT) {
        reject(new Error('body too large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (!text) return resolve({})
      try {
        resolve(JSON.parse(text))
      } catch {
        reject(new Error('invalid json'))
      }
    })
    request.on('error', reject)
  })
}

/* -------------------------------------------------------------- plugin body */

export function apply(ctx, rawConfig) {
  const config = rawConfig || {}
  const state = {
    restarting: false,
    requestedAt: 0,
    lastMechanism: null,
    lastError: null,
  }

  const settings = () => ({
    mechanism: ['auto', 'opencli', 'exit'].includes(String(config.mechanism)) ? String(config.mechanism) : 'auto',
    endpoint: String(config.endpoint || ''),
    accessToken: String(config.accessToken || ''),
    socketId: String(config.socketId || 'ugreen.dockerserv.internal.grpc'),
    containerId: String(config.containerId || ''),
    rejectUnauthorized: config.rejectUnauthorized === true,
    requestTimeoutMs: Math.max(1000, Number(config.requestTimeoutMs) || 10000),
    exitDelayMs: Math.max(0, Number(config.exitDelayMs) || 700),
    cooldownMs: Math.max(0, Number(config.cooldownMs) || 5000),
  })

  /** Run the restart; `exit` is scheduled by the caller after the reply flushes. */
  const performRestart = async () => {
    const current = settings()
    const wantsOpenCLI = current.mechanism === 'opencli'
      || (current.mechanism === 'auto' && current.endpoint !== '' && current.accessToken !== '')
    if (wantsOpenCLI) {
      try {
        const result = await restartThroughOpenCLI(current)
        return { mechanism: 'opencli', containerId: result.containerId }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        state.lastError = message
        if (current.mechanism === 'opencli') throw error
      }
    }
    return { mechanism: 'exit', fallbackFrom: current.mechanism === 'auto' ? state.lastError : null }
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: STATUS_PATH,
    handler: (request, response) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        sendJson(response, 405, { ok: false, error: 'method-not-allowed' })
        return
      }
      sendJson(response, 200, {
        ok: true,
        bootId: BOOT_ID,
        pid: process.pid,
        startedAt: STARTED_AT,
        mechanism: settings().mechanism,
        gatewayConfigured: settings().endpoint !== '' && settings().accessToken !== '',
        restarting: state.restarting,
        lastMechanism: state.lastMechanism,
        lastError: state.lastError,
      })
    },
  }), 'dsh-restart-button: status route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: RESTART_PATH,
    handler: async (request, response) => {
      if (request.method !== 'POST') {
        sendJson(response, 405, { ok: false, error: 'method-not-allowed' })
        return
      }
      if (!sameOriginRequest(request)) {
        sendJson(response, 403, { ok: false, error: 'cross-origin' })
        return
      }
      const type = String((request.headers || {})['content-type'] || '')
      if (!/^application\/json\s*(;|$)/i.test(type)) {
        sendJson(response, 415, { ok: false, error: 'json-only' })
        return
      }
      try {
        const body = await readJsonBody(request)
        if (!body || body.confirm !== true) {
          sendJson(response, 400, { ok: false, error: 'confirm-required' })
          return
        }
      } catch {
        sendJson(response, 400, { ok: false, error: 'invalid-body' })
        return
      }
      const current = settings()
      const now = Date.now()
      if (state.restarting || now - state.requestedAt < current.cooldownMs) {
        sendJson(response, 409, {
          ok: false,
          error: 'already-restarting',
          bootId: BOOT_ID,
          restarting: state.restarting,
        })
        return
      }
      state.requestedAt = now
      state.restarting = true
      try {
        const outcome = await performRestart()
        state.lastMechanism = outcome.mechanism
        sendJson(response, 200, { ok: true, ...outcome, bootId: BOOT_ID, pid: process.pid })
        if (outcome.mechanism === 'exit') {
          // Let the reply reach the browser before the container goes down.
          setTimeout(() => process.exit(0), current.exitDelayMs)
        }
      } catch (error) {
        state.restarting = false
        state.lastMechanism = null
        const message = error instanceof Error ? error.message : String(error)
        state.lastError = message
        sendJson(response, 502, { ok: false, error: 'restart-failed', message })
      }
    },
  }), 'dsh-restart-button: restart route')
}
