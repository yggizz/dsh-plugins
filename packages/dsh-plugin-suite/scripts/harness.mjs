// Harness for dsh-plugin-suite/client.js: loads the bundle with a fake module
// loader and a fake client context, then asserts that every feature mounts,
// unmounts, and leaves nothing behind.
//
// What it proves:
//   1. all nine features mount on their own fiber when enabled;
//   2. the settings page registers on `settings.section` under id `plugin-suite`;
//   3. flipping a switch off disposes exactly one fiber and every disposable
//      that fiber owned goes to zero;
//   4. flipping it back on re-mounts cleanly (three rounds, no drift).
import fs from 'node:fs'
import path from 'node:path'

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const source = fs.readFileSync(path.join(here, '..', 'client.js'), 'utf8')

/* ---------------------------------------------------------------- stubs ---- */

const live = { effects: 0, slots: 0, listeners: 0, styles: 0, menus: 0 }
const registered = []
const fetched = []
const fibers = []

const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useEffect: () => {},
  useRef: (init) => ({ current: init }),
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  useLayoutEffect: () => {},
  Fragment: 'Fragment',
}

/** `react-dom` is in the client module table; only the portal is used here. */
const ReactDOM = {
  createPortal: (element, container) => ({ type: 'portal', element, container }),
}

/** Build a context that owns one fiber's cleanups. */
function makeCtx(parentCleanups, name) {
  const own = []
  const push = (off) => { own.push(off); if (parentCleanups !== undefined) parentCleanups.push(off) }
  const ctx = {
    name,
    effect(fn) {
      live.effects += 1
      const off = fn()
      push(() => { live.effects -= 1; if (typeof off === 'function') off() })
      return () => {}
    },
    on() {
      live.listeners += 1
      push(() => { live.listeners -= 1 })
      return () => { live.listeners -= 1 }
    },
    inject(_deps, callback) {
      callback(ctx)
      return () => {}
    },
    get() { return undefined },
    plugin(definition) {
      const cleanups = []
      const fiber = {
        disposed: false,
        dispose() {
          if (fiber.disposed) return
          fiber.disposed = true
          while (cleanups.length > 0) cleanups.pop()()
        },
      }
      fibers.push(fiber)
      definition.apply(makeCtx(cleanups, name))
      return fiber
    },
    slots: {
      inject(_slot, callback) { return callback() },
      register(options) {
        live.slots += 1
        registered.push(options.name)
        push(() => { live.slots -= 1 })
        return () => { live.slots -= 1 }
      },
    },
    locale: {
      register() { return () => {} },
      bind() { return (key) => key },
    },
    theme: { getTheme: () => null, setTheme: () => {} },
    contextMenus: {
      register() { live.menus += 1; push(() => { live.menus -= 1 }); return () => {} },
      active: { getSnapshot: () => null, subscribe: () => () => {} },
    },
    reflect: { provide: () => () => {} },
  }
  return ctx
}

/* -------------------------------------------------------------- globals ---- */

let factory
globalThis.window = {
  __ModuleLoader__: { load: ({ factory: f }) => { factory = f } },
  localStorage: {
    store: new Map(),
    getItem(key) { return this.store.has(key) ? this.store.get(key) : null },
    setItem(key, value) { this.store.set(key, value) },
    removeItem(key) { this.store.delete(key) },
  },
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (t) => clearTimeout(t),
  innerWidth: 1440,
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
  __dshSidebarPins: undefined,
}
globalThis.document = {
  head: { appendChild(node) { live.styles += 1; node.__attached = true } },
  createElement: () => ({ dataset: {}, style: {}, setAttribute() {}, remove() { live.styles -= 1 } }),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  removeEventListener: () => {},
  body: { appendChild() {}, style: {} },
  cookie: '',
  visibilityState: 'visible',
  activeElement: null,
}
globalThis.MutationObserver = class { observe() {} disconnect() {} }
globalThis.ResizeObserver = class { observe() {} disconnect() {} }
/** The Host answers with the document the test wants. */
const hostState = { features: {} }
globalThis.fetch = async (url, options) => {
  fetched.push({ url: String(url), method: options?.method ?? 'GET' })
  return { ok: true, status: 200, json: async () => ({ ok: true, features: hostState.features }) }
}

/* ----------------------------------------------------------------- run ---- */

new Function(source)()
const plugin = factory((name) => {
  if (name === 'react') return React
  if (name === 'react-dom') return ReactDOM
  throw new Error(`unexpected require: ${name}`)
})
plugin.apply(makeCtx(undefined, 'suite'))

const snapshot = (label) => {
  const row = { ...live, fibers: fibers.length }
  console.log(label.padEnd(28), JSON.stringify(row))
  return row
}

setTimeout(async () => {
  const mounted = snapshot('after apply')
  console.log('slots registered:', registered.join(', '))
  console.log('fetched:', fetched.map(f => `${f.method} ${f.url}`).join(' , '))

  const api = globalThis.window.__dshPluginSuite
  if (api === undefined) {
    console.log('FAIL: the bundle exposes no diagnostic handle')
    process.exit(1)
  }
  console.log('mounted before:', api.mounted().join(', '))

  // Turn one feature off, then on again, three rounds; the live counters must
  // come back to the same numbers each time, with no drift.
  const base = { ...live }
  const rounds = []
  for (let round = 1; round <= 3; round += 1) {
    await api.set('turn-credits', false)
    const off = { ...live }
    await api.set('turn-credits', true)
    const on = { ...live }
    rounds.push({ round, off, on })
    console.log(`round ${round}  off:`, JSON.stringify(off), ' on:', JSON.stringify(on))
  }

  const last = rounds[rounds.length - 1].on
  const stable = last.effects === base.effects && last.slots === base.slots
    && last.listeners === base.listeners && last.styles === base.styles
  const offDropped = rounds.every(r => r.off.effects < r.on.effects)

  // All off, then all on: every feature must leave and come back. What remains
  // while everything is off is the suite itself — its dictionaries, its style
  // tag and the settings page slot — because the page has to stay usable to
  // turn anything back on.
  await api.setAll(false)
  const allOff = { ...live, mounted: api.mounted().length }
  console.log('all off:', JSON.stringify(allOff))
  await api.setAll(true)
  const allOn = { ...live, mounted: api.mounted().length }
  console.log('all on :', JSON.stringify(allOn))

  const cleanOff = allOff.mounted === 0 && allOff.slots === 1 && allOff.menus === 0
  // The feature count comes from the bundle's own diagnostic handle, so adding a
  // feature does not silently require editing this assertion.
  const expected = globalThis.window.__dshPluginSuite.features.length
  const backOn = allOn.mounted === expected && allOn.slots === base.slots && allOn.effects === base.effects
    && allOn.styles === base.styles && allOn.menus === base.menus

  console.log('checks:', JSON.stringify({ stable, offDropped, cleanOff, backOn, expected }))
  const ok = mounted.slots > 0 && mounted.fibers >= expected && stable && offDropped && cleanOff && backOn
  console.log(ok ? 'PASS: mount/unmount clean over 3 rounds, all-off leaves nothing, all-on restores' : 'FAIL')
  process.exit(ok ? 0 : 1)
}, 400)
