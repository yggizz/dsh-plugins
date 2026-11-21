/**
 * dsh-approval-zh — Host half.
 *
 * The approval card is rendered by shipped Client code; its headline is
 * whatever the requester put in `displayReason`/`reason`, and DSH's own
 * escalation prose is partly English. This half owns one same-origin route
 * that turns such a headline into Chinese: fixed DSH sentences come from a
 * local dictionary, leftover English prose goes through the Host `translator`
 * service (anonymous endpoint by default), and identifier-like tokens are
 * shielded so tool names, paths, JSON and sandbox modes keep their original
 * spelling. Results are cached per exact headline.
 *
 * Nothing here changes an approval decision, the audit reason, or the
 * requester's text — only the presentation copy the browser asks for.
 */
export const name = 'dsh-approval-zh'
export const inject = ['webServer']

import { translateApprovalText } from './translate.js'

/*
 * A workspace-linked bundle resolves bare specifiers from its own directory,
 * so the schema package is optional: without it the row still activates and
 * `apply` reads the raw config with the same defaults.
 */
async function buildConfigSchema() {
  try {
    const module = await import('@deepseek-ai/schemastery')
    const z = module.default ?? module
    if (!z || typeof z.object !== 'function') return undefined
    return z.object({
      /** Translate leftover English prose through the Host translator. */
      machineTranslate: z.boolean().default(true),
      /** Empty follows the translator's own configured provider. */
      provider: z.string().default(''),
      /** Second endpoint used only when the first returns unreadable copy; empty disables the retry. */
      fallbackProvider: z.string().default('google'),
      /** Deadline for one headline; the card keeps the original text on expiry. */
      timeoutMs: z.number().default(5000),
      /** Headlines longer than this are left untouched. */
      maxChars: z.number().default(4000),
      /** Translated headlines kept in memory. */
      cacheSize: z.number().default(300),
    })
  } catch {
    return undefined
  }
}

export const Config = await buildConfigSchema()

const ROUTE = '/api/dsh-approval-zh/translate'
const STATUS_ROUTE = '/api/dsh-approval-zh/status'
const BODY_LIMIT = 32 * 1024

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

/* -------------------------------------------------------------- plugin body */

export function apply(ctx, rawConfig) {
  const config = rawConfig || {}
  const settings = () => ({
    machineTranslate: config.machineTranslate !== false,
    provider: String(config.provider || ''),
    fallbackProvider: String(config.fallbackProvider ?? 'google'),
    timeoutMs: Math.max(500, Number(config.timeoutMs) || 5000),
    maxChars: Math.max(64, Number(config.maxChars) || 4000),
    cacheSize: Math.max(0, Number(config.cacheSize) || 300),
  })

  /** Exact headline -> Chinese, insertion-ordered so the oldest entries go first. */
  const cache = new Map()

  const remember = (source, translated) => {
    const limit = settings().cacheSize
    if (limit === 0) return
    cache.set(source, translated)
    while (cache.size > limit) {
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
    if (translator === undefined || !settings().machineTranslate) return [null]
    const build = (provider) => async (text) => {
      if (typeof text !== 'string' || text.trim() === '') return text
      const request = { text, targetLanguage: 'zh-CN', sourceLanguage: 'en' }
      const spec = translator.resolve(provider === '' ? request : { ...request, provider })
      const signal = AbortSignal.timeout(settings().timeoutMs)
      return await translator.translate(spec, signal)
    }
    const primary = settings().provider
    const fallback = settings().fallbackProvider
    const list = [build(primary)]
    if (fallback !== '' && fallback !== primary) list.push(build(fallback))
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
        machineTranslate: settings().machineTranslate,
        translator: ctx.get('translator') !== undefined,
        providers: [settings().provider || 'translator-default', settings().fallbackProvider].filter(Boolean),
        cached: cache.size,
      })
    },
  }), 'dsh-approval-zh: status route')

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
      if (source.length > settings().maxChars) {
        sendJson(response, 200, { ok: true, text: source, changed: false, reason: 'too-long' })
        return
      }
      const cached = cache.get(source)
      if (cached !== undefined) {
        sendJson(response, 200, { ok: true, text: cached, changed: cached !== source, source: 'cache' })
        return
      }
      const translator = ctx.get('translator')
      const machines = machineTranslators(translator)
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
  }), 'dsh-approval-zh: translate route')
}
