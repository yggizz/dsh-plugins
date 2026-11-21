/**
 * Restart the Harness container from the Web sidebar — Host half.
 *
 * Two same-origin routes the Client half calls:
 *
 *   GET  /api/dsh-restart/status    a per-process `bootId` the Client polls
 *                                   until it changes (a container restart may
 *                                   reuse the PID, so the PID is no signal).
 *   POST /api/dsh-restart/restart   end this process after the reply flushes;
 *                                   the container's restart policy
 *                                   (`unless-stopped`) brings it straight back.
 *
 * The switch is per-process: after the restart the feature mounts again from
 * `~/.dsh/plugin-suite.json`, so the button returns with the suite.
 */
import { randomUUID } from 'node:crypto'

const STATUS_PATH = '/api/dsh-restart/status'
const RESTART_PATH = '/api/dsh-restart/restart'
const BODY_LIMIT = 1024
const EXIT_DELAY_MS = 700
const COOLDOWN_MS = 5000

/** One identifier per Node process: the Client polls until it changes. */
const BOOT_ID = randomUUID()
const STARTED_AT = new Date().toISOString()

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

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload)
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.setHeader('content-length', Buffer.byteLength(body))
  response.end(body)
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

/**
 * Register the status and restart routes.
 * @param ctx - the feature's Cordis context.
 */
export function apply(ctx) {
  const state = { restarting: false, requestedAt: 0 }

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
        mechanism: 'exit',
        gatewayConfigured: false,
        restarting: state.restarting,
        lastMechanism: null,
        lastError: null,
      })
    },
  }), 'plugin-suite: restart status route')

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
      const now = Date.now()
      if (state.restarting || now - state.requestedAt < COOLDOWN_MS) {
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
      sendJson(response, 200, { ok: true, mechanism: 'exit', bootId: BOOT_ID, pid: process.pid })
      // Let the reply reach the browser before the container goes down.
      setTimeout(() => process.exit(0), EXIT_DELAY_MS)
    },
  }), 'plugin-suite: restart route')
}
