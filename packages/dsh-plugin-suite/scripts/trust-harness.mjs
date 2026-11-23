// Harness for the Host route trust rule in dsh-plugin-suite/index.js.
//
// The regression it guards: on a Dockerised deployment the browser sends
// `Host: 192.168.0.103:3080` while the socket's `localAddress` is the container
// bridge, so a loopback-only rule answered `403 host-not-trusted` to every
// switch save and the settings page could never persist anything.
//
// It checks three things:
//   1. a loopback Host is admitted with no `connection` service at all;
//   2. a non-loopback Host is admitted only when DSH's fence says so;
//   3. a route body that keeps its own loopback guard â€?the two verbatim Host
//      halves â€?still passes, because the wrapper rewrites the socket address.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(here, '..', 'index.js'), 'utf8')

/* ---------------------------------------------------------------- stubs ---- */

const routes = new Map()
const webServer = {
  getOrigin: () => 'http://127.0.0.1:1234',
  register(route) {
    if (routes.has(route.path)) throw new Error(`webserver: duplicate exact route "${route.path}"`)
    routes.set(route.path, route)
    return () => routes.delete(route.path)
  },
}

/** The fence's answer for the next request; `undefined` means admitted. */
let fenceAnswer
let fenceCalls = 0
const connection = {
  requestRejection() {
    fenceCalls += 1
    return fenceAnswer
  },
}

/** A containerised socket: the listener's address is the bridge, not the Host. */
const socket = { localAddress: '172.19.0.2', remoteAddress: '172.19.0.1' }

function makeCtx({ withConnection }) {
  const ctx = {
    effect(fn) {
      const off = fn()
      return () => { if (typeof off === 'function') off() }
    },
    on() { return () => {} },
    inject(deps, callback) {
      if (deps.includes('webServer')) callback(ctx)
      return () => {}
    },
    get(key) {
      if (key === 'webServer') return webServer
      if (key === 'connection') return withConnection ? connection : undefined
      return undefined
    },
    plugin(definition) {
      const inner = []
      const child = makeCtx({ withConnection })
      const realEffect = child.effect
      child.effect = (fn) => {
        const off = realEffect(fn)
        inner.push(typeof off === 'function' ? off : () => {})
        return off
      }
      const fiber = {
        ctx: child,
        dispose() { while (inner.length > 0) inner.pop()() },
      }
      definition.apply(child)
      return fiber
    },
    webServer,
  }
  return ctx
}

/** Load index.js with its two feature halves stubbed out. */
function loadSuite() {
  const body = source
    .replace(/^import .*$/gm, '')
    .replace(/^export function apply\(/m, 'function apply(')
  const module = { exports: {} }
  new Function('module', 'exports', 'applyArtifactCopy', 'applyTurnCredits', 'applyApprovalZh', 'applyRestartButton', `${body}
module.exports = { apply }`)(module, module.exports, stubFeature, stubFeature, stubFeature, stubFeature)
  return module.exports.apply
}

/** A Host feature whose route body keeps its own verbatim loopback guard. */
function stubFeature(featureCtx) {
  featureCtx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: `/plugins/${Math.random().toString(36).slice(2)}/probe`,
      handler: (request, response) => {
        // This is `hostIsLocal` from features/host/*.js, byte for byte.
        const host = request.headers.host
        let hostname
        try {
          hostname = new URL(`http://${host}`).hostname
        } catch {
          hostname = ''
        }
        const bare = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
        const local = request.socket?.localAddress
        const admitted = bare === 'localhost' || bare === '::1' || bare.endsWith('.localhost')
          || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(bare)
          || (typeof local === 'string' && local !== '' && (local === bare || `[${local}]` === hostname))
        response.statusCode = admitted ? 200 : 403
        response.setHeader('content-type', 'application/json; charset=utf-8')
        response.end(JSON.stringify({ admitted, seenLocal: local, seenHost: host }))
      },
    }))
  })
}

/* ----------------------------------------------------------------- run ---- */

const results = []
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  results.push(ok)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` â€?got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`}`)
}

/** Call one route handler with a fabricated request. */
async function call(routePath, host, { method = 'GET', headers = {} } = {}) {
  const route = routes.get(routePath)
  if (route === undefined) throw new Error(`no route ${routePath}`)
  let body = ''
  const response = {
    statusCode: 0,
    setHeader() {},
    end(chunk) { body = String(chunk ?? '') },
  }
  const request = {
    method,
    url: routePath,
    headers: { host, ...headers },
    socket,
    on(event, handler) {
      if (event === 'end') handler()
      return this
    },
    destroy() {},
  }
  await route.handler(request, response)
  return { status: response.statusCode, body }
}

/** Let the async switch-document load finish, which is what mounts Host features. */
const settle = () => new Promise(resolve => setTimeout(resolve, 20))

/* 1. No connection service: loopback admitted, LAN refused. */
loadSuite()(makeCtx({ withConnection: false }))
await settle()
const statePath = '/plugins/plugin-suite/state'
const loopback = await call(statePath, '127.0.0.1:64332')
check('no connection + loopback Host â†?200', loopback.status, 200)
const lanNoFence = await call(statePath, '192.168.0.103:3080')
check('no connection + LAN Host â†?403', lanNoFence.status, 403)
check('403 body names the reason', JSON.parse(lanNoFence.body).error, 'host-not-trusted')

/* 2. With the fence: the LAN Host the fence admits is answered. */
routes.clear()
loadSuite()(makeCtx({ withConnection: true }))
await settle()
fenceAnswer = undefined
const lanAdmitted = await call(statePath, '192.168.0.103:3080')
check('fence admits + LAN Host â†?200', lanAdmitted.status, 200)
check('fence was consulted for the LAN Host', fenceCalls > 0, true)
fenceAnswer = 403
const lanRefused = await call(statePath, '192.168.0.103:3080')
check('fence refuses + LAN Host â†?403', lanRefused.status, 403)
fenceAnswer = 401
const lanUnauthed = await call(statePath, '192.168.0.103:3080')
check('fence answers 401 + LAN Host â†?403', lanUnauthed.status, 403)

/* 3. The verbatim host guard inside a wrapped feature still passes. */
routes.clear()
fenceAnswer = undefined
loadSuite()(makeCtx({ withConnection: true }))
await settle()
// Both Host features mount from the same stub; take the artifact-copy route.
const featurePaths = [...routes.keys()].filter(p => p !== statePath)
check('four wrapped feature routes mounted', featurePaths.length, 4)
for (const featurePath of featurePaths) {
  const admitted = await call(featurePath, '192.168.0.103:3080')
  const parsed = JSON.parse(admitted.body)
  check(`wrapped feature route sees localAddress == Host`, parsed.seenLocal, '192.168.0.103')
  check(`wrapped feature route admits the LAN Host`, admitted.status, 200)
  const raw = await call(featurePath, '192.168.0.103:3080')
  check(`the original socket is left alone`, socket.localAddress, '172.19.0.2')
  if (raw.status !== 200) results.push(false)
}

/* 4. A refused request is NOT rewritten: the feature's own guard still 403s. */
routes.clear()
fenceAnswer = 403
loadSuite()(makeCtx({ withConnection: true }))
await settle()
const deniedPaths = [...routes.keys()].filter(p => p !== statePath)
for (const deniedPath of deniedPaths) {
  const denied = await call(deniedPath, '192.168.0.103:3080')
  check('unadmitted request keeps the real socket address', JSON.parse(denied.body).seenLocal, '172.19.0.2')
  check('unadmitted request is refused by the verbatim guard', denied.status, 403)
}

const failed = results.filter(ok => !ok).length
console.log(failed === 0 ? `PASS: ${results.length}/${results.length} trust checks` : `FAIL: ${failed}/${results.length} trust checks failed`)
process.exit(failed === 0 ? 0 : 1)
