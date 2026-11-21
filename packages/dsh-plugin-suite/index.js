/**
 * dsh-plugin-suite — Host half.
 *
 * Owns two things:
 *
 *  1. **The switch document** (`~/.dsh/plugin-suite.json`), served on
 *     `/plugins/plugin-suite/state`. The Client keeps a localStorage mirror so
 *     the first frame after a reload mounts the right features without a flash,
 *     but this file is the authority: it survives a Web origin port change
 *     between Desktop launches, a different browser, and a wiped profile.
 *  2. **The features that need a Host** — the file right-click copy routes and the
 *     per-turn spend routes plus its session feed. All live in
 *     `features/host/*.js` **verbatim** and are
 *     mounted as their own Cordis fibers, so a switch is a real uninstall on
 *     this side too: disposing the fiber unregisters the routes and drops the
 *     `session/event` listener.
 *
 * The other features are Client-only; `client.js` mounts and unmounts them.
 *
 * Route security: a request is answered when it is loopback (the desktop client)
 * **or** when DSH's own browser-trust fence admits it — `ctx.connection
 * .requestRejection()`, the same check every `/api` call passes, which knows
 * about the listener's bind address and each `--trusted-host`. The second arm
 * exists because a Docker port mapping breaks the first: the browser sends
 * `Host: 192.168.0.103:3080` while the socket's `localAddress` is the container
 * bridge (`172.19.0.2`), so a loopback-only rule rejects every switch save on a
 * containerised deployment with `403 host-not-trusted`.
 */
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { apply as applyArtifactCopy } from './features/host/artifact-copy.js'
import { apply as applyTurnCredits } from './features/host/turn-credits.js'
import { apply as applyApprovalZh } from './features/host/approval-zh.js'
import { apply as applyRestartButton } from './features/host/restart-button.js'

/* --------------------------------------------------------------- paths ---- */

/** The DSH home directory, honouring an explicit override. */
function dshHome() {
  const configured = process.env.DSH_HOME
  return configured !== undefined && configured.trim() !== '' ? configured.trim() : join(homedir(), '.dsh')
}

/** The switch document's absolute path. */
function stateFile() {
  return join(dshHome(), 'plugin-suite.json')
}

/* ------------------------------------------------------------ features ---- */

/** Every switchable feature, in settings-page order. The Client mirrors this list. */
const FEATURE_IDS = [
  'artifact-copy',
  'theme-toggle',
  'turn-credits',
  'hide-branch',
  'sidebar-pins',
  'rightbar-default-open',
  'archive-filter-toggle',
  'approval-zh',
  'restart-button',
]

/** The switch document's shape version. */
const STATE_VERSION = 1

/**
 * The Host halves, by feature id. A feature absent from this table is
 * Client-only: its switch still works, it just has nothing to do here.
 */
const HOST_FEATURES = new Map([
  ['artifact-copy', applyArtifactCopy],
  ['turn-credits', applyTurnCredits],
  ['approval-zh', applyApprovalZh],
  ['restart-button', applyRestartButton],
])

/* ----------------------------------------------------------------- http ---- */

/** Send one JSON answer. */
function sendJson(response, status, value) {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(value))
}

/** Whether the Host header names the socket this request arrived on. */
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

/**
 * Whether DSH's browser-trust fence admits this request.
 *
 * `ctx.connection` may be absent (a profile without the Web app, or a harness),
 * in which case only the loopback arm applies. When it is present the fence must
 * answer `undefined` — the request is both trusted and authenticated, exactly
 * what `/api` requires — so a LAN origin still cannot drive the document.
 * @param ctx - the plugin's Cordis context.
 * @returns a predicate over an incoming request.
 */
function createTrust(ctx) {
  return (request) => {
    if (hostIsLocal(request)) return true
    const connection = typeof ctx.get === 'function' ? ctx.get('connection') : undefined
    if (connection === undefined || typeof connection.requestRejection !== 'function') return false
    try {
      return connection.requestRejection(request) === undefined
    } catch {
      return false
    }
  }
}

/** Read a bounded JSON body. */
function readJsonBody(request, limit = 64 * 1024) {
  return new Promise((accept, reject) => {
    const chunks = []
    let size = 0
    request.on('data', chunk => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('body-too-large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (size === 0) {
        accept({})
        return
      }
      try {
        accept(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('bad-json'))
      }
    })
    request.on('error', reject)
  })
}

/* ---------------------------------------------------------- the switches ---- */

/**
 * The switch document in memory, with a write-through save.
 *
 * The file is written through a temporary + rename, so a crash mid-write cannot
 * leave a half document: a reader sees either the old file or the new one.
 */
function createSwitches() {
  /** Every feature defaults to enabled, so a fresh install behaves like before. */
  const data = { version: STATE_VERSION, features: {} }
  for (const id of FEATURE_IDS) data.features[id] = true
  let loading
  let saving = false
  let pending = false

  /** Read the document once; a missing or unreadable file keeps the defaults. */
  async function load() {
    if (loading !== undefined) return loading
    loading = (async () => {
      let raw
      try {
        raw = await fs.readFile(stateFile(), 'utf8')
      } catch {
        return
      }
      let parsed
      try {
        parsed = JSON.parse(raw)
      } catch {
        return
      }
      const features = parsed && parsed.features
      if (features === null || typeof features !== 'object') return
      for (const id of FEATURE_IDS) {
        if (typeof features[id] === 'boolean') data.features[id] = features[id]
      }
    })()
    await loading
  }

  /** Serialize one save; a request arriving mid-save schedules another pass. */
  async function save() {
    if (saving) {
      pending = true
      return
    }
    saving = true
    try {
      const path = stateFile()
      await fs.mkdir(dirname(path), { recursive: true })
      const temporary = `${path}.tmp`
      await fs.writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
      await fs.rename(temporary, path)
    } catch (error) {
      console.warn('[plugin-suite] could not persist switches:', error instanceof Error ? error.message : String(error))
    } finally {
      saving = false
      if (pending) {
        pending = false
        await save()
      }
    }
  }

  return {
    data,
    load,
    /**
     * Set one feature's switch.
     * @param {string} id - feature id.
     * @param {boolean} enabled - desired state.
     * @returns {Promise<boolean>} false for an unknown feature.
     */
    async set(id, enabled) {
      if (!FEATURE_IDS.includes(id)) return false
      if (data.features[id] !== enabled) {
        data.features[id] = enabled
        await save()
      }
      return true
    },
    /**
     * Set every feature's switch.
     * @param {boolean} enabled - desired state.
     */
    async setAll(enabled) {
      let changed = false
      for (const id of FEATURE_IDS) {
        if (data.features[id] !== enabled) {
          data.features[id] = enabled
          changed = true
        }
      }
      if (changed) await save()
    },
    /**
     * Whether one feature is on.
     * @param {string} id - feature id.
     * @returns {boolean} the switch.
     */
    isOn(id) {
      return data.features[id] === true
    },
  }
}

/* ------------------------------------------------------------- the plugin ---- */

/**
 * Present a request whose socket address already matches its Host header.
 *
 * The two Host halves in `features/host/*.js` are kept byte-identical to their
 * standalone originals, and their own guard only accepts a loopback Host or a
 * Host equal to `request.socket.localAddress`. On a containerised deployment
 * behind a port mapping those never match (browser sends `192.168.0.103:3080`,
 * socket says `172.19.0.2`), so the guard would 403 even though DSH's fence
 * admits the request. Rather than fork the verbatim bodies, the wrapper hands
 * them a request view whose socket reports the hostname they are looking for —
 * and only when the fence has already admitted the request.
 * @param request - the incoming request.
 * @returns the request, or a view with a matching `socket.localAddress`.
 */
function admitView(request) {
  const host = request.headers?.host
  if (typeof host !== 'string' || host.trim() === '') return request
  let hostname
  try {
    hostname = new URL(`http://${host}`).hostname
  } catch {
    return request
  }
  const bare = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
  return new Proxy(request, {
    get(target, key, receiver) {
      if (key !== 'socket') return Reflect.get(target, key, receiver)
      const socket = target.socket
      if (socket === undefined || socket === null) return socket
      return new Proxy(socket, {
        get(socketTarget, socketKey, socketReceiver) {
          if (socketKey === 'localAddress') return bare
          const value = Reflect.get(socketTarget, socketKey, socketReceiver)
          return typeof value === 'function' ? value.bind(socketTarget) : value
        },
      })
    },
  })
}

/**
 * Wrap one route so its handler sees an admitted request view.
 * @param route - the route a Host feature asked to register.
 * @param trusted - the suite's trust predicate.
 * @returns the route, with its handler wrapped.
 */
function trustRoute(route, trusted) {
  if (route === null || typeof route !== 'object' || typeof route.handler !== 'function') return route
  const handler = route.handler
  return {
    ...route,
    handler: (request, response) => handler(trusted(request) ? admitView(request) : request, response),
  }
}

/**
 * Wrap a feature context so a route that is already taken does not abort the
 * feature, and is retried until it becomes free.
 *
 * The Host halves are verbatim and register their routes in sequence. While the
 * standalone version of the same plugin is still enabled in the profile, its
 * routes are already on the web server and `register()` throws
 * `webserver: duplicate exact route "…"`. Left alone, that throw escapes the
 * feature's `apply`, leaves the earlier routes of the same feature registered
 * and loses the fiber, so the switch could never clean up.
 *
 * A skipped route is queued and retried: the standalone plugin is expected to be
 * disabled eventually, and the moment it is, its routes disappear and this one
 * can take them over. Without the retry the suite would keep serving nothing on
 * that path until the next restart — the exact gap that showed up when the six
 * standalone bundles were switched off.
 * @param {object} ctx - the feature's child context.
 * @param {Set<object>} pending - routes this feature still wants to register.
 * @param {(request: object) => boolean} trusted - the suite's trust predicate.
 * @returns {object} the same context, with a duplicate-tolerant web server.
 */
function tolerantCtx(ctx, pending, trusted) {
  /** Wrap one web server so `register` retries instead of throwing for a taken path. */
  const wrapWebServer = (server) => {
    if (server === undefined || server === null || typeof server.register !== 'function') return server
    return new Proxy(server, {
      get(target, key, receiver) {
        if (key !== 'register') return Reflect.get(target, key, receiver)
        return (route) => {
          try {
            return target.register(trustRoute(route, trusted))
          } catch (error) {
            console.warn('[plugin-suite] route already served elsewhere, will retry:', route?.path, '—',
              error instanceof Error ? error.message : String(error))
            pending.add(route)
            return () => {}
          }
        }
      },
    })
  }
  return new Proxy(ctx, {
    get(target, key, receiver) {
      if (key === 'inject') {
        return (deps, callback) => target.inject(deps, inner => callback(tolerantCtx(inner, pending, trusted)))
      }
      const value = Reflect.get(target, key, receiver)
      if (key === 'webServer') return wrapWebServer(value)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

/**
 * Register the Host half.
 * @param ctx - the plugin's Cordis context.
 */
export function apply(ctx) {
  const switches = createSwitches()
  /** The trust predicate every route of this plugin uses. */
  const trusted = createTrust(ctx)
  /** feature id → the fiber its Host half runs on. */
  const mounted = new Map()
  /**
   * feature id → why its Host half could not mount.
   *
   * The one real cause is a duplicate route: the standalone plugin for the same
   * feature is still enabled in this profile, and the web server refuses to
   * register `/plugins/artifact-copy/probe` twice (`webserver: duplicate exact
   * route`). That is a coexistence state, not a defect — the standalone plugin
   * keeps serving until it is disabled — so it is reported rather than thrown.
   */
  const failures = new Map()
  /**
   * feature id → routes that feature could not register because another plugin
   * still serves them. Retried on a timer until they succeed, so disabling the
   * standalone plugin hands the path over without a restart.
   */
  const pendingRoutes = new Map()

  /**
   * Try once more to register every route that was refused earlier.
   *
   * `webServer.register` is the only way to know whether a path is free (there is
   * no lookup on the public face), so the retry is a plain re-register: the one
   * that succeeds is kept, the ones still taken stay queued.
   */
  function retryPendingRoutes() {
    for (const [id, routes] of pendingRoutes) {
      const fiber = mounted.get(id)
      if (fiber === undefined) {
        pendingRoutes.delete(id)
        continue
      }
      const server = ctx.get?.('webServer')
      if (server === undefined || typeof server.register !== 'function') continue
      for (const route of [...routes]) {
        try {
          const off = server.register(trustRoute(route, trusted))
          // The feature's own fiber must own this disposer, so it leaves with it.
          fiber.ctx?.effect?.(() => off)
          routes.delete(route)
          console.info('[plugin-suite] route taken over:', route?.path)
        } catch {
          /* still held by the other plugin */
        }
      }
      if (routes.size === 0) pendingRoutes.delete(id)
    }
  }

  /**
   * Mount one feature's Host half on its own fiber.
   * @param {string} id - feature id.
   */
  function mount(id) {
    const body = HOST_FEATURES.get(id)
    if (body === undefined || mounted.has(id)) return
    const pending = new Set()
    try {
      const fiber = ctx.plugin({ inject: [], apply: featureCtx => body(tolerantCtx(featureCtx, pending, trusted)) })
      mounted.set(id, fiber)
      failures.delete(id)
      if (pending.size > 0) pendingRoutes.set(id, pending)
    } catch (error) {
      failures.set(id, error instanceof Error ? error.message : String(error))
      console.warn('[plugin-suite] host mount failed:', id, failures.get(id))
    }
  }

  /**
   * Dispose one feature's Host fiber, which unregisters its routes and listeners.
   * @param {string} id - feature id.
   */
  function unmount(id) {
    const fiber = mounted.get(id)
    if (fiber === undefined) return
    mounted.delete(id)
    pendingRoutes.delete(id)
    try {
      fiber.dispose()
    } catch (error) {
      console.warn('[plugin-suite] host unmount failed:', id, error)
    }
  }

  /**
   * Make the running Host set match one switch.
   * @param {string} id - feature id.
   * @param {boolean} enabled - desired state.
   */
  function applySwitch(id, enabled) {
    if (enabled) mount(id)
    else unmount(id)
  }

  // The document arrives asynchronously; the default (all on) is what a fresh
  // install wants, and the read corrects it before any switch is flipped.
  void switches.load().then(() => {
    for (const id of HOST_FEATURES.keys()) applySwitch(id, switches.isOn(id))
  })

  ctx.effect(() => () => {
    for (const id of [...mounted.keys()]) unmount(id)
  }, 'plugin-suite: host features')

  // The retry clock: a route refused because a standalone plugin still holds it
  // is re-offered every few seconds, so switching that plugin off hands the path
  // over live. It stops itself once nothing is queued.
  ctx.effect(() => {
    const timer = setInterval(retryPendingRoutes, 3000)
    timer.unref?.()
    return () => clearInterval(timer)
  }, 'plugin-suite: route takeover')

  ctx.inject(['webServer'], webCtx => {
    ctx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: '/plugins/plugin-suite/state',
      handler: async (request, response) => {
        if (!trusted(request)) return sendJson(response, 403, { ok: false, error: 'host-not-trusted' })
        if (request.method === 'GET') {
          await switches.load()
          return sendJson(response, 200, { ok: true, version: STATE_VERSION, features: { ...switches.data.features } })
        }
        if (request.method !== 'POST') return sendJson(response, 405, { ok: false, error: 'method-not-allowed' })
        let body
        try {
          body = await readJsonBody(request)
        } catch {
          return sendJson(response, 400, { ok: false, error: 'bad-request' })
        }
        await switches.load()
        if (typeof body.all === 'boolean') {
          await switches.setAll(body.all)
          for (const id of HOST_FEATURES.keys()) applySwitch(id, switches.isOn(id))
          return sendJson(response, 200, { ok: true, version: STATE_VERSION, features: { ...switches.data.features } })
        }
        const id = typeof body.id === 'string' ? body.id : ''
        const enabled = body.enabled
        if (id === '' || typeof enabled !== 'boolean') return sendJson(response, 400, { ok: false, error: 'bad-request' })
        if (!(await switches.set(id, enabled))) return sendJson(response, 404, { ok: false, error: 'unknown-feature' })
        applySwitch(id, enabled)
        return sendJson(response, 200, { ok: true, version: STATE_VERSION, features: { ...switches.data.features } })
      },
    }), 'plugin-suite: switch route')
  })
}
