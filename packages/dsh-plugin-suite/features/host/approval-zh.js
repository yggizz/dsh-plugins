/**
 * Approval-card Chinese headline — Host half.
 *
 * The approval card is rendered by shipped Client code; its headline is the
 * requester's `displayReason`/`reason`, and DSH's own escalation prose is partly
 * English. This feature owns one same-origin route that renders such a headline
 * in Chinese: fixed DSH sentences come from the local dictionary, leftover
 * English prose goes through the Host `translator` service, and identifier-like
 * tokens are shielded so tool names, paths, JSON and sandbox modes keep their
 * original spelling. Results are cached per exact headline.
 *
 * Nothing here changes an approval decision, the audit reason, or the
 * requester's text — only the presentation copy the browser asks for.
 */
import { translateApprovalText } from './approval-zh-translate.js'

const ROUTE = '/api/dsh-approval-zh/translate'
const STATUS_ROUTE = '/api/dsh-approval-zh/status'
const BODY_LIMIT = 32 * 1024

/** Fixed settings: the suite exposes one switch, not a settings form. */
const SETTINGS = {
  machineTranslate: true,
  provider: '',
  fallbackProvider: 'google',
  timeoutMs: 5000,
  maxChars: 4000,
  cacheSize: 300,
}

/** Only the page served by this Host may ask; another site must not probe it. */
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
 * Register the translate and status routes.
 * @param ctx - the feature's Cordis context.
 */
export function apply(ctx) {
  /** Exact headline -> Chinese, insertion-ordered so the oldest entries go first. */
  const cache = new Map()

  const remember = (source, translated) => {
    cache.set(source, translated)
    while (cache.size > SETTINGS.cacheSize) {
      const oldest = cache.keys().next()
      if (oldest.done) break
      cache.delete(oldest.value)
    }
  }

  /**
   * Machine translation through the Host service, in fallback order.
   * A lone `null` means dictionary-only: no text leaves this process.
   */
  const machineTranslators = (translator) => {
    if (translator === undefined || !SETTINGS.machineTranslate) return [null]
    const build = (provider) => async (text) => {
      if (typeof text !== 'string' || text.trim() === '') return text
      const request = { text, targetLanguage: 'zh-CN', sourceLanguage: 'en' }
      const spec = translator.resolve(provider === '' ? request : { ...request, provider })
      const signal = AbortSignal.timeout(SETTINGS.timeoutMs)
      return await translator.translate(spec, signal)
    }
    const list = [build(SETTINGS.provider)]
    if (SETTINGS.fallbackProvider !== '' && SETTINGS.fallbackProvider !== SETTINGS.provider) {
      list.push(build(SETTINGS.fallbackProvider))
    }
    return list
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: STATUS_ROUTE,
    handler: (request, response) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        sendJson(response, 405, { ok: false, error: 'method-not-allowed' })
        return
      }
      sendJson(response, 200, {
        ok: true,
        machineTranslate: SETTINGS.machineTranslate,
        translator: ctx.get('translator') !== undefined,
        providers: [SETTINGS.provider || 'translator-default', SETTINGS.fallbackProvider].filter(Boolean),
        cached: cache.size,
      })
    },
  }), 'plugin-suite: approval-zh status route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE,
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
      let body
      try {
        body = await readJsonBody(request)
      } catch {
        sendJson(response, 400, { ok: false, error: 'invalid-body' })
        return
      }
      const source = typeof body?.text === 'string' ? body.text : ''
      if (source.trim() === '') {
        sendJson(response, 400, { ok: false, error: 'text-required' })
        return
      }
      if (source.length > SETTINGS.maxChars) {
        sendJson(response, 200, { ok: true, text: source, changed: false, reason: 'too-long' })
        return
      }
      const cached = cache.get(source)
      if (cached !== undefined) {
        sendJson(response, 200, { ok: true, text: cached, changed: cached !== source, source: 'cache' })
        return
      }
      const machines = machineTranslators(ctx.get('translator'))
      try {
        const result = await translateApprovalText(source, machines)
        if (result.changed) remember(source, result.text)
        sendJson(response, 200, {
          ok: true,
          text: result.text,
          changed: result.changed,
          source: machines[0] === null ? 'dictionary' : 'dictionary+machine',
        })
      } catch (error) {
        // Translation is decoration: on any failure the card keeps what it has.
        sendJson(response, 200, {
          ok: false,
          text: source,
          changed: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    },
  }), 'plugin-suite: approval-zh translate route')
}
