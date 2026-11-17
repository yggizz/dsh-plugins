/**
 * Turn spend — Host half.
 *
 * WHAT THIS DOES
 * Puts the money a completed Turn actually cost into that reply's own action
 * row, in the currency the route it used bills in:
 *
 *   - WorkBuddy (`workbuddy`, `workbuddy-global`) bills in credits.
 *   - The DeepSeek account route (`deepseek-account`) bills a CNY wallet.
 *   - The DeepSeek API-key route (`deepseek-official`) bills the platform
 *     account behind that key.
 *
 * A Session that uses none of those gets no pill at all.
 *
 * HOW IT KNOWS
 * None of these providers states a settled charge anywhere DSH can read: the
 * WorkBuddy adapter reads `usage.credit` on its probe path and drops it, and
 * DSH's own `TokenUsage` carries tokens only. So the amount is measured, not
 * estimated: the balance is read at `turn/start` (before the first request is
 * sent) and again after `turn/end`, and the difference is attributed to that
 * Turn. Every balance read is read-only and free — the WorkBuddy one is the
 * same endpoint its card's 「立即刷新」 button uses, the DeepSeek account one is
 * what the 账号与余额 page reads, and the API-key one is DeepSeek's documented
 * `/user/balance` endpoint.
 *
 * COST
 * Two balance reads per Turn and about a second of settle time after the Turn
 * closes. The first read is detached, so the first token is never delayed.
 *
 * WHEN IT SHOWS NOTHING
 * The Turn used no billable route, sign-in or the selected account changed, the
 * balance did not move within the settle delay, or the reads failed. Those are
 * all real "not measured": nothing is stored and the Client draws an em dash.
 *
 * KNOWN LIMIT
 * A difference can only describe the window it brackets, so a concurrent spend
 * from another Session inside the same window lands on this Turn too. That is
 * inherent to measuring balances rather than reading a per-request charge.
 */

import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

/**
 * The billable routes this plugin measures.
 *
 * `unit` is what the figure is denominated in and what the Client formats:
 * `credits` for WorkBuddy, `CNY` for both DeepSeek routes. `source` says how to
 * read that balance.
 */
const SOURCES = {
  workbuddy: { unit: 'credits', source: 'workbuddy', region: 'cn' },
  'workbuddy-global': { unit: 'credits', source: 'workbuddy', region: 'global' },
  'deepseek-account': { unit: 'CNY', source: 'deepseek-account' },
  'deepseek-official': { unit: 'CNY', source: 'deepseek-key' },
}

/** This plugin's Client-facing route. */
const STATE_PATH = '/plugins/turn-spend/state'

/** The connector plugin's per-account credit route: one upstream read, no check-in. */
const ACCOUNT_CREDITS_PATH = '/plugins/dsh-connect-workbuddy/account-credits'

/** DeepSeek's documented balance endpoint, authenticated with the same key as inference. */
const DEEPSEEK_BALANCE_URL = 'https://api.deepseek.com/user/balance'

/** The default credential reference the official API-key route reads. */
const DEEPSEEK_API_KEY_REF = 'DEEPSEEK_API_KEY'

/** Turns kept per session; older ones are dropped rather than growing without bound. */
const MAX_TURNS_PER_SESSION = 300

/** Sessions kept on disk. */
const MAX_SESSIONS = 200

/** How long to wait after `turn/end` for the upstream to settle its charge. */
const SETTLE_MS = 1200

/**
 * Extra settle attempts, per unit.
 *
 * WorkBuddy updates its credit balance within about a second, so one settle read
 * is enough. DeepSeek's platform wallet settles in batches that can lag a
 * couple of minutes behind the request, so a single read 1.2s after `turn/end`
 * almost always reports the pre-turn balance and would print 0 for a turn that
 * really cost money. These are re-read at the listed offsets; the first attempt
 * that finds a movement wins, and the rest are dropped.
 */
const SETTLE_SCHEDULE_MS = {
  credits: [SETTLE_MS],
  CNY: [SETTLE_MS, 15000, 45000, 90000, 180000],
}

/** Delay before a failed balance read is retried once. */
const RETRY_MS = 700

/** Per-attempt ceiling for one balance read. */
const READ_TIMEOUT_MS = 15000

/** DSH home, matching the connector's own resolution when DSH_HOME is unset. */
function dshHome() {
  const configured = process.env.DSH_HOME
  return configured !== undefined && configured.trim() !== '' ? configured.trim() : join(homedir(), '.dsh')
}

/** File holding the per-turn figures. */
function stateFile() {
  return join(dshHome(), 'turn-spend.json')
}

/** A finite, non-negative number, or undefined for anything else. */
function finiteNumber(value) {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof parsed === 'number' && Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

/** One wallet array summed in one currency. */
function sumWallets(wallets, currency) {
  if (!Array.isArray(wallets)) return undefined
  let total
  for (const wallet of wallets) {
    if (wallet?.currency !== currency) continue
    const value = finiteNumber(wallet?.balance)
    if (value === undefined) continue
    total = (total ?? 0) + value
  }
  return total
}

/**
 * WorkBuddy credits: the selected login's remaining balance.
 *
 * `account-credits` answers one entry per discovered login, each carrying a
 * `selected` flag; an explicitly selected account is the one the connector
 * spends from, so it wins. Without an explicit selection the first entry that
 * reports a balance is used, which is what the connector itself falls back to.
 */
async function readWorkbuddyCredits(origin, region) {
  let body
  try {
    const response = await fetch(`${origin}${ACCOUNT_CREDITS_PATH}?region=${region}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    })
    if (!response.ok) return undefined
    body = await response.json()
  } catch {
    return undefined
  }
  const accounts = Array.isArray(body?.accounts) ? body.accounts : []
  if (accounts.length === 0) return undefined
  const selected = accounts.find(entry => entry?.selected === true)
  const chosen = finiteNumber(selected?.credits)
  if (chosen !== undefined) return chosen
  for (const entry of accounts) {
    const value = finiteNumber(entry?.credits)
    if (value !== undefined) return value
  }
  return undefined
}

/**
 * The DeepSeek account route: the signed-in account's CNY wallets.
 *
 * Recharge and bonus wallets are separate entries in the same currency, and the
 * 账号与余额 page shows their sum, so summing keeps this plugin's "balance" and
 * the page's "余额" the same number.
 */
async function readDeepseekAccountBalance(account) {
  if (typeof account?.getBalance !== 'function') return undefined
  let outcome
  try {
    outcome = await account.getBalance({
      version: '0.0.0',
      locale: 'zh-CN',
      timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
    })
  } catch {
    return undefined
  }
  // The service answers the balance OUTCOME itself — `{status:'ready', value: wallets}`
  // — not the `AccountDetails` wrapper that also carries a profile.
  if (outcome === null || outcome?.status !== 'ready' || !Array.isArray(outcome.value)) return undefined
  return sumWallets(outcome.value, 'CNY') ?? sumWallets(outcome.bonusWallets, 'CNY')
}

/** The DeepSeek API-key route: the platform balance behind that key. */
async function readDeepseekKeyBalance(credentials) {
  if (typeof credentials?.resolve !== 'function') return undefined
  let key
  try {
    const resolved = await credentials.resolve(DEEPSEEK_API_KEY_REF)
    key = typeof resolved === 'string' ? resolved : resolved?.value
  } catch {
    return undefined
  }
  if (typeof key !== 'string' || key === '') return undefined
  let body
  try {
    const response = await fetch(DEEPSEEK_BALANCE_URL, {
      headers: { accept: 'application/json', authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    })
    if (!response.ok) return undefined
    body = await response.json()
  } catch {
    return undefined
  }
  const infos = Array.isArray(body?.balance_infos) ? body.balance_infos : []
  const cny = infos.find(info => info?.currency === 'CNY') ?? infos[0]
  return finiteNumber(cny?.total_balance)
}

/**
 * Read one route's remaining balance.
 *
 * @param deps - the resolved services this read may use.
 * @param source - one {@link SOURCES} entry.
 * @returns the balance in the entry's own unit, or undefined when unreadable.
 */
async function readBalance(deps, source) {
  switch (source.source) {
    case 'workbuddy':
      return readWorkbuddyCredits(deps.origin, source.region)
    case 'deepseek-account':
      return readDeepseekAccountBalance(deps.deepseekAccount)
    case 'deepseek-key':
      return readDeepseekKeyBalance(deps.credentials)
    default:
      return undefined
  }
}

/** Read the balance, retrying once: one dropped read must not lose a whole turn's figure. */
async function readBalanceWithRetry(deps, source) {
  const first = await readBalance(deps, source)
  if (first !== undefined) return first
  await new Promise(resolve => setTimeout(resolve, RETRY_MS))
  return readBalance(deps, source)
}

/**
 * Shape-only diagnostics for the DeepSeek account read, never credentials.
 *
 * A null balance can mean "signed out", "the platform call failed" or "a shape
 * this build does not parse", and those need different fixes; this reports the
 * part that tells them apart.
 */
async function accountProbeDetail(account) {
  if (typeof account?.getBalance !== 'function') return { service: 'absent' }
  try {
    const details = await account.getBalance({
      version: '0.0.0',
      locale: 'zh-CN',
      timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
    })
    if (details === null) return { service: 'present', result: 'null' }
    return {
      service: 'present',
      status: details?.status ?? 'missing',
      wallets: Array.isArray(details?.value) ? details.value.map(wallet => ({ currency: wallet?.currency, balance: wallet?.balance })) : null,
      bonus: Array.isArray(details?.bonusWallets) ? details.bonusWallets.map(wallet => ({ currency: wallet?.currency, balance: wallet?.balance })) : null,
    }
  } catch (thrown) {
    return { service: 'present', error: thrown instanceof Error ? `${thrown.name}: ${thrown.message}` : String(thrown) }
  }
}

/** Whether a Host header names the socket this request arrived on, as the connector's routes require. */
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

/** Send one JSON answer. */
function sendJson(response, status, value) {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(value))
}

/**
 * The durable figures plus the in-flight measurement state around them.
 *
 * A Session entry records which route it spends on (the Client needs that to
 * decide whether the Session gets a pill and which unit to print), each Turn's
 * measured amount, and which durable assistant message closed each Turn — the
 * Slot's own currency is a message id, so that mapping has to survive a restart.
 */
function createStore() {
  /** @type {{ sessions: Record<string, { provider?: string, unit?: string, turns: Record<string, number>, messages: Record<string, number> }> }} */
  const data = { sessions: {} }
  let saveTimer
  let saving = false

  function scheduleSave() {
    if (saveTimer !== undefined) return
    saveTimer = setTimeout(() => {
      saveTimer = undefined
      void save()
    }, 1200)
    saveTimer.unref?.()
  }

  async function save() {
    if (saving) {
      scheduleSave()
      return
    }
    saving = true
    try {
      const path = stateFile()
      await fs.mkdir(dirname(path), { recursive: true })
      const temporary = `${path}.tmp`
      await fs.writeFile(temporary, JSON.stringify(data), 'utf8')
      await fs.rename(temporary, path)
    } catch {
      // A figure that could not be persisted is still correct in memory, and the
      // Client reads the live store first; only a restart loses it.
    } finally {
      saving = false
    }
  }

  function sessionOf(sessionId) {
    const existing = data.sessions[sessionId]
    if (existing !== undefined) {
      existing.turns ??= {}
      existing.messages ??= {}
      return existing
    }
    const created = { turns: {}, messages: {} }
    data.sessions[sessionId] = created
    return created
  }

  /** Drop the oldest Turns (and their message links) once a Session grows past the cap. */
  function prune(session) {
    const turns = Object.keys(session.turns)
    if (turns.length <= MAX_TURNS_PER_SESSION) return
    const dropped = new Set(turns.sort((left, right) => Number(left) - Number(right)).slice(0, turns.length - MAX_TURNS_PER_SESSION))
    for (const turn of dropped) delete session.turns[turn]
    for (const [messageId, turn] of Object.entries(session.messages)) {
      if (dropped.has(String(turn))) delete session.messages[messageId]
    }
  }

  function pruneSessions() {
    const sessionIds = Object.keys(data.sessions)
    if (sessionIds.length <= MAX_SESSIONS) return
    sessionIds.slice(0, sessionIds.length - MAX_SESSIONS).forEach(sessionId => { delete data.sessions[sessionId] })
  }

  function record(sessionId, turn, amount) {
    if (typeof sessionId !== 'string' || sessionId === '' || !Number.isInteger(turn)) return
    if (amount === undefined || !Number.isFinite(amount) || amount <= 0) return
    const session = sessionOf(sessionId)
    session.turns[String(turn)] = Number(amount.toFixed(6))
    prune(session)
    pruneSessions()
    scheduleSave()
  }

  /**
   * Remember a Session's billable route and which Turn an assistant message
   * closed. Written before any figure exists, because the Client needs the route
   * to decide whether the Session gets a pill at all and in which unit.
   */
  function noteSession(sessionId, provider, unit, messageId, turn) {
    if (typeof sessionId !== 'string' || sessionId === '') return
    const session = sessionOf(sessionId)
    let changed = false
    if (provider !== undefined && (session.provider !== provider || session.unit !== unit)) {
      session.provider = provider
      session.unit = unit
      changed = true
    }
    if (typeof messageId === 'string' && messageId !== '' && Number.isInteger(turn) && session.messages[messageId] !== turn) {
      session.messages[messageId] = turn
      changed = true
    }
    if (changed) {
      prune(session)
      pruneSessions()
      scheduleSave()
    }
  }

  return {
    data,
    sessionOf,
    noteSession,
    record,
    async load() {
      try {
        const parsed = JSON.parse(await fs.readFile(stateFile(), 'utf8'))
        if (parsed === null || typeof parsed !== 'object') return
        const sessions = parsed.sessions
        if (sessions === null || typeof sessions !== 'object') return
        for (const [sessionId, value] of Object.entries(sessions)) {
          const turns = value?.turns
          if (turns === null || typeof turns !== 'object') continue
          const clean = {}
          for (const [turn, amount] of Object.entries(turns)) {
            const number = finiteNumber(amount)
            if (Number.isInteger(Number(turn)) && number !== undefined) clean[turn] = number
          }
          const messages = {}
          if (value?.messages !== null && typeof value?.messages === 'object') {
            for (const [messageId, turn] of Object.entries(value.messages)) {
              if (Number.isInteger(turn) && clean[String(turn)] !== undefined) messages[messageId] = turn
            }
          }
          data.sessions[sessionId] = {
            ...(typeof value?.provider === 'string' ? { provider: value.provider } : {}),
            ...(typeof value?.unit === 'string' ? { unit: value.unit } : {}),
            turns: clean,
            messages,
          }
        }
      } catch {
        // No file yet (first run) or an unreadable one: start empty.
      }
    },
    dispose() {
      if (saveTimer !== undefined) {
        clearTimeout(saveTimer)
        saveTimer = undefined
      }
      void save()
    },
  }
}

/**
 * Register the Host half.
 *
 * @param ctx - the plugin's Cordis context.
 */
export function apply(ctx) {
  const store = createStore()

  /** Session id → the billable route its latest request was aimed at. */
  const providerOf = new Map()
  /** Session id → the measurement in flight for its open Turn. */
  const openTurns = new Map()
  /** Every event type seen, for the diagnostics route. */
  const seenEventTypes = new Set()
  /** The last few measurement attempts, for the diagnostics route. */
  const attempts = []
  /** Services resolved lazily; any of them may be absent in a given profile. */
  const deps = { origin: undefined, deepseekAccount: undefined, credentials: undefined }
  let origin

  // Seed from the persisted store so a reload mid-conversation keeps knowing
  // which Sessions spend, and on what.
  void store.load().then(() => {
    for (const [sessionId, session] of Object.entries(store.data.sessions)) {
      if (typeof session.provider === 'string' && SOURCES[session.provider] !== undefined) providerOf.set(sessionId, session.provider)
    }
  })

  ctx.effect(() => () => { store.dispose() }, 'turn-spend: persist')

  function remember(entry) {
    attempts.push(entry)
    if (attempts.length > 20) attempts.shift()
  }

  /** The route entry for a Session, resolved from memory or from the Session itself. */
  function sourceOf(sessionId, session) {
    let provider = providerOf.get(sessionId)
    if (provider === undefined && session !== undefined) {
      try {
        const candidate = session.requestContext?.()?.provider
        if (typeof candidate === 'string' && SOURCES[candidate] !== undefined) provider = candidate
      } catch {
        provider = undefined
      }
    }
    if (provider === undefined) return undefined
    providerOf.set(sessionId, provider)
    store.noteSession(sessionId, provider, SOURCES[provider].unit)
    return SOURCES[provider]
  }

  /**
   * The Turn a Session is currently inside, when the plugin needs it before it
   * saw that Turn's `turn/start`.
   *
   * `ctx.agents.turnBoundaryOf` reads the committed log, which is the only
   * source that also covers a Turn already running when this plugin loaded.
   */
  function currentTurnOf(session) {
    const agents = ctx.get?.('agents')
    if (agents === undefined) return undefined
    try {
      const boundary = agents.turnBoundaryOf(session)
      return boundary?.openTurnStartSeq !== null && boundary?.openTurnStartSeq !== undefined ? boundary.lastTurn : undefined
    } catch {
      return undefined
    }
  }

  /**
   * Open one Turn's measurement.
   *
   * Called at `turn/start`, which is before the Turn's first model request and
   * therefore before anything is spent. The read runs detached: nothing awaits
   * it until `turn/end`, so the first token is never delayed by a balance call.
   */
  function openMeasurement(sessionId, turn, session) {
    const source = sourceOf(sessionId, session)
    if (source === undefined || deps.origin === undefined) {
      openTurns.set(sessionId, { turn, source: undefined, before: undefined })
      remember({ sessionId, turn, phase: 'open-skipped', reason: source === undefined ? 'no-route' : 'no-origin' })
      return
    }
    remember({ sessionId, turn, phase: 'open', provider: providerOf.get(sessionId) })
    openTurns.set(sessionId, { turn, source, before: readBalanceWithRetry(deps, source).catch(() => undefined) })
  }

  /** Close one Turn's measurement and record what it billed, when that is knowable. */
  async function closeMeasurement(sessionId, turn) {
    const state = openTurns.get(sessionId)
    openTurns.delete(sessionId)
    if (state === undefined) {
      remember({ sessionId, turn, phase: 'close-skipped', reason: 'no-open-state' })
      return
    }
    if (state.turn !== turn) {
      remember({ sessionId, turn, phase: 'close-skipped', reason: `state-turn-${state.turn}` })
      return
    }
    if (state.before === undefined || state.source === undefined) {
      remember({ sessionId, turn, phase: 'close-skipped', reason: 'no-before' })
      return
    }
    const before = await state.before
    if (before === undefined) {
      remember({ sessionId, turn, phase: 'close-skipped', reason: 'before-unreadable' })
      return
    }
    const schedule = SETTLE_SCHEDULE_MS[state.source.unit] ?? [SETTLE_MS]
    let previousDelay = 0
    for (const offset of schedule) {
      await new Promise(resolve => setTimeout(resolve, Math.max(0, offset - previousDelay)))
      previousDelay = offset
      const after = await readBalance(deps, state.source)
      if (after === undefined) {
        remember({ sessionId, turn, phase: 'close-skipped', reason: 'after-unreadable', before, offset })
        continue
      }
      const delta = before - after
      remember({ sessionId, turn, phase: 'close', before, after, delta, unit: state.source.unit, offset })
      if (Number.isFinite(delta) && delta > 0) {
        store.record(sessionId, turn, delta)
        return
      }
    }
  }

  /**
   * The event handler for one Session.
   *
   * `session/event` on this plugin's own context does receive the durable feed
   * (`collectSessionCallbacks(entry.emitCtx, …)` in `dsh-session` dispatches from
   * the Store's context). `request/header` is NOT delivered here in the live
   * Host, which is why the route is read from `session.requestContext()`; that
   * value is committed before the first request spends anything.
   */
  function onSessionEvent(session, event) {
    const sessionId = session?.id
    if (typeof sessionId !== 'string' || sessionId === '') return
    if (event?.type !== undefined && seenEventTypes.size < 40) seenEventTypes.add(event.type)
    switch (event.type) {
      case 'request/header': {
        const provider = event.data?.header?.config?.provider
        if (typeof provider === 'string' && SOURCES[provider] !== undefined) {
          providerOf.set(sessionId, provider)
          store.noteSession(sessionId, provider, SOURCES[provider].unit)
        }
        // A Turn that is already open (its `turn/start` arrived before the route
        // was known) still gets its "before" read here: the header is emitted
        // before the request is sent.
        const state = openTurns.get(sessionId)
        if (state !== undefined && state.source === undefined) openMeasurement(sessionId, state.turn, session)
        return
      }
      case 'assistant/message': {
        const provider = event.data?.message?.source?.provider
        const messageId = event.data?.message?.id
        const turn = event.data?.turn
        if (typeof provider === 'string' && SOURCES[provider] !== undefined) {
          providerOf.set(sessionId, provider)
          store.noteSession(sessionId, provider, SOURCES[provider].unit, messageId, turn)
        }
        return
      }
      case 'turn/start':
        openMeasurement(sessionId, event.data.turn, session)
        return
      case 'turn/end':
        void closeMeasurement(sessionId, event.data.turn)
        return
      default:
    }
  }

  const stopSessionFeed = ctx.on('session/event', (session, event) => {
    onSessionEvent(session, event)
  })

  ctx.effect(() => () => { stopSessionFeed?.() }, 'turn-spend: session feed')

  // Optional services: the WorkBuddy route needs the local HTTP server, the two
  // DeepSeek routes need the account and credential services. A profile without
  // any of them keeps the routes it does have.
  ctx.inject(['webServer'], webCtx => {
    origin = webCtx.webServer.getOrigin()
    deps.origin = origin

    ctx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: STATE_PATH,
      handler: async (request, response) => {
        if (request.method !== 'GET') return sendJson(response, 405, { error: 'method not allowed' })
        if (!hostIsLocal(request)) return sendJson(response, 403, { error: 'host-not-trusted' })
        let sessionId = ''
        let messageId = ''
        let debug = false
        let params
        try {
          params = new URL(request.url ?? '/', 'http://localhost').searchParams
        } catch {
          return sendJson(response, 400, { error: 'bad request' })
        }
        sessionId = params.get('sessionId') ?? ''
        messageId = params.get('messageId') ?? ''
        debug = params.get('debug') === '1'
        if (sessionId === '') return sendJson(response, 200, { sessionId, turns: {} })
        if (debug && params.get('probe') === '1') {
          // Runs the real balance read, so an empty result can be attributed to
          // the endpoint rather than to a listener that never fired.
          const provider = params.get('provider') ?? 'workbuddy'
          const source = SOURCES[provider]
          let value
          let error
          try {
            value = source === undefined ? undefined : await readBalanceWithRetry(deps, source)
          } catch (thrown) {
            error = thrown instanceof Error ? `${thrown.name}: ${thrown.message}` : String(thrown)
          }
          return sendJson(response, 200, { probe: { provider, unit: source?.unit ?? null, balance: value ?? null, ...(error === undefined ? {} : { error }), ...(source?.source === 'deepseek-account' ? { detail: await accountProbeDetail(deps.deepseekAccount) } : {}) } })
        }
        const session = store.data.sessions[sessionId]
        // The Slot's currency is a message id; the figure is stored per Turn, so
        // the message is resolved here rather than on the Client, which never
        // sees Turn numbers for a reply.
        const turn = messageId === '' ? undefined : session?.messages?.[messageId]
        const amount = turn === undefined ? undefined : session?.turns?.[String(turn)]
        const body = {
          sessionId,
          ...(messageId === '' ? {} : { messageId }),
          ...(session?.provider === undefined ? {} : { provider: session.provider }),
          ...(session?.unit === undefined ? {} : { unit: session.unit }),
          ...(turn === undefined ? {} : { turn }),
          ...(typeof amount === 'number' ? { amount } : {}),
          turns: session?.turns ?? {},
        }
        if (!debug) return sendJson(response, 200, body)
        return sendJson(response, 200, {
          ...body,
          attempts,
          diagnostics: {
            seenEvents: [...seenEventTypes],
            providers: Object.fromEntries(providerOf),
            openTurns: Object.fromEntries(
              [...openTurns].map(([id, state]) => [id, { turn: state.turn, provider: providerOf.get(id) ?? null, hasBefore: state.before !== undefined }]),
            ),
            services: {
              origin: deps.origin ?? null,
              deepseekAccount: typeof deps.deepseekAccount?.getBalance === 'function',
              credentials: typeof deps.credentials?.resolve === 'function',
            },
          },
        })
      },
    }), 'turn-spend: state route')
  })

  ctx.inject(['deepseekAccount'], accountCtx => {
    deps.deepseekAccount = accountCtx.deepseekAccount
    return () => { deps.deepseekAccount = undefined }
  })

  ctx.inject(['credentials'], credentialCtx => {
    deps.credentials = credentialCtx.credentials
    return () => { deps.credentials = undefined }
  })
}
