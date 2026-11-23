// Harness for dsh-plugin-suite/index.js: proves the duplicate-route takeover.
//
// Scenario: the suite mounts while a standalone plugin still owns
// `/plugins/turn-spend/state`, so that registration is refused and queued. The
// standalone plugin is then switched off, which frees the path; the retry clock
// must take it over without a restart.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(here, '..', 'index.js'), 'utf8')

/* ---------------------------------------------------------------- stubs ---- */

/** Paths currently held, standing in for the web server's route table. */
const taken = new Set()
const log = []

/** The route each stubbed Host feature asks for, in call order. */
const stubPaths = ['/plugins/artifact-copy/probe', '/plugins/turn-spend/state']
let stubCursor = 0
stubFeature.nextPath = () => stubPaths[stubCursor++ % stubPaths.length]

const webServer = {
  getOrigin: () => 'http://127.0.0.1:1234',
  register(route) {
    if (taken.has(route.path)) throw new Error(`webserver: duplicate exact route "${route.path}"`)
    taken.add(route.path)
    log.push(`registered ${route.path}`)
    return () => { taken.delete(route.path); log.push(`released ${route.path}`) }
  },
}

/** Stand-in for the standalone plugins that still hold two paths at boot. */
taken.add('/plugins/artifact-copy/probe')
taken.add('/plugins/artifact-copy/copy')
taken.add('/plugins/turn-spend/state')

const effects = []
const cleanups = []

function makeCtx(name) {
  const own = []
  const ctx = {
    name,
    effect(fn) {
      const off = fn()
      own.push(() => { if (typeof off === 'function') off() })
      return () => {}
    },
    on() { return () => {} },
    inject(deps, callback) {
      if (deps.includes('webServer')) callback(ctx)
      return () => {}
    },
    get(key) {
      if (key === 'webServer') return webServer
      if (key === 'agents') return undefined
      return undefined
    },
    plugin(definition) {
      const inner = []
      const fiber = {
        disposed: false,
        ctx: undefined,
        dispose() {
          if (fiber.disposed) return
          fiber.disposed = true
          while (inner.length > 0) inner.pop()()
        },
      }
      const child = makeCtx(name + ':child')
      const realEffect = child.effect
      child.effect = (fn) => {
        const off = realEffect(fn)
        inner.push(typeof off === 'function' ? off : () => {})
        return off
      }
      fiber.ctx = child
      definition.apply(child)
      effects.push(fiber)
      return fiber
    },
    webServer,
    agents: undefined,
  }
  cleanups.push(own)
  return ctx
}

/* ----------------------------------------------------------------- run ---- */

const module = { exports: {} }
// Strip the ESM import lines and turn the single `export function apply` into a
// plain function, so the Host half runs inside this harness unchanged. The two
// imported feature halves are stubbed: this harness tests the suite's own route
// bookkeeping, not their bodies (the client harness covers mounting).
const body = source
  .replace(/^import .*$/gm, '')
  .replace(/^export function apply\(/m, 'function apply(')
/* Every Host half the index imports is stubbed: this harness tests the suite's own
   route bookkeeping, not those feature bodies (their own harnesses cover them). */
new Function('module', 'exports', 'applyArtifactCopy', 'applyTurnCredits', 'applyApprovalZh', 'applyRestartButton', `${body}
module.exports = { apply }`)(module, module.exports, stubFeature, stubFeature, stubFeature, stubFeature)

/** A minimal Host feature: one route, registered the same way the real ones do. */
function stubFeature(featureCtx) {
  featureCtx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: stubFeature.nextPath(),
      handler: () => {},
    }))
  })
}

module.exports.apply(makeCtx('suite'))

const report = (label) => {
  const held = [...taken].sort().join(' ')
  console.log(label.padEnd(34), '| held:', held || '(none)')
}

report('boot (standalone owns 3)')

setTimeout(() => {
  report('t=0 after mount')
  // The standalone plugins are switched off: their routes disappear.
  for (const p of ['/plugins/artifact-copy/probe', '/plugins/artifact-copy/copy', '/plugins/turn-spend/state']) taken.delete(p)
  report('standalone switched off')
}, 100)

setTimeout(() => {
  report('t=3.5s after takeover')
  // The two stubbed features each ask for one path; both were refused at boot and
  // must be held now. `/plugins/artifact-copy/copy` is only in the "taken" set to
  // prove an unrequested path is left alone.
  const ok = taken.has('/plugins/artifact-copy/probe')
    && taken.has('/plugins/turn-spend/state')
    && taken.has('/plugins/plugin-suite/state')
  console.log('takeover log:', log.filter(l => l.startsWith('registered')).join(' , '))
  console.log(ok ? 'PASS: refused routes taken over without a restart' : 'FAIL: a route stayed unregistered')
  process.exit(ok ? 0 : 1)
}, 3600)
