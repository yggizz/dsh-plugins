// Harness for the theme-toggle write guard in dsh-plugin-suite/client.js.
//
// The guard exists because `ThemeRuntime.write()` never inspects its settings
// write: a refused write (`settings-conflict` against the crowded profile
// patch) still falls through to `adopt()`, which re-applies the durable value
// and flips the UI back a few seconds after the click, silently.
//
// What it proves:
//   1. a click arms the guard and calls setTheme with the requested id;
//   2. a bounce back to the replaced value re-issues the click;
//   3. a bounce to a THIRD value is treated as the user's own choice;
//   4. a durable layer that already holds the requested value stops the guard;
//   5. the guard stops after its retry budget instead of looping forever.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(here, '..', 'client.js'), 'utf8')

/* ---------------------------------------------------------------- stubs ---- */

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

const ReactDOM = { createPortal: (element, container) => ({ type: 'portal', element, container }) }

/** Theme handlers the features registered, keyed by event name. */
const handlers = new Map()
/** Every setTheme call, in order. */
const setThemeCalls = []
/** Slot registrations, so the harness can reach the real component. */
const registrations = []

/** The theme face the feature reads; tests mutate `preference` here. */
const themeFace = {
  preference: 'light',
  getTheme: () => ({ preference: themeFace.preference, active: { colorScheme: themeFace.preference } }),
  setTheme: (id) => {
    setThemeCalls.push(id)
    themeFace.preference = id
  },
}

/** Durable layer the guard consults; undefined means "form not readable". */
const durable = { preference: undefined }
const forms = { get: () => ({ getSnapshot: () => ({ value: durable.preference === undefined ? undefined : { preference: durable.preference } }) }) }

function makeCtx(name) {
  const own = []
  return {
    name,
    effect(fn) {
      const off = fn()
      own.push(() => { if (typeof off === 'function') off() })
      return () => {}
    },
    on(event, handler) {
      const list = handlers.get(event) ?? []
      list.push(handler)
      handlers.set(event, list)
      const off = () => {
        const now = handlers.get(event) ?? []
        handlers.set(event, now.filter((candidate) => candidate !== handler))
      }
      own.push(off)
      return off
    },
    inject(_deps, callback) { callback(makeCtx(name)); return () => {} },
    get(key) {
      if (key === 'locale') return { getLocale: () => ({ id: 'zh-CN' }) }
      if (key === 'configForms') return forms
      return undefined
    },
    plugin(definition) {
      const fiber = { disposed: false, dispose() { fiber.disposed = true } }
      definition.apply(makeCtx(name))
      return fiber
    },
    slots: {
      inject(_slot, callback) { return callback() },
      register(options, component) {
        registrations.push({ options, component })
        return () => {}
      },
    },
    locale: { register() { return () => {} }, bind() { return (key) => key } },
    theme: themeFace,
    contextMenus: {
      register() { return () => {} },
      active: { getSnapshot: () => null, subscribe: () => () => {} },
    },
    reflect: { provide: () => () => {} },
  }
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
}
globalThis.document = {
  head: { appendChild() {} },
  createElement: () => ({ dataset: {}, style: {}, setAttribute() {}, remove() {} }),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  removeEventListener: () => {},
  body: { appendChild() {}, style: {} },
  documentElement: { setAttribute() {}, removeAttribute() {} },
  cookie: '',
  visibilityState: 'visible',
  activeElement: null,
}
globalThis.MutationObserver = class { observe() {} disconnect() {} }
globalThis.ResizeObserver = class { observe() {} disconnect() {} }
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, features: {} }) })

/* ------------------------------------------------------------------ run ---- */

new Function('window', 'document', 'require', source)(globalThis.window, globalThis.document, (id) => {
  if (id === 'react') return React
  if (id === 'react-dom') return ReactDOM
  return {}
})
const plugin = factory((id) => (id === 'react' ? React : id === 'react-dom' ? ReactDOM : {}))
const root = makeCtx('root')
root.plugin(plugin)

/** Fire the feature's own theme listener with one snapshot. */
const emitTheme = (preference) => {
  themeFace.preference = preference
  const snapshot = { preference, active: { colorScheme: preference } }
  for (const handler of handlers.get('theme/change') ?? []) handler(snapshot)
}

/** The sidebar-foot theme button, i.e. the one a user clicks. */
const foot = registrations.find((row) => row.options.name === 'sidebar.footer.action' && row.options.id === 'theme-toggle')
if (foot === undefined) {
  console.error('FAIL: the theme toggle did not register on sidebar.footer.action')
  process.exit(1)
}

/** Click it once. */
const click = () => {
  const element = foot.component({ wide: true })
  element.props.onClick()
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const results = []
const check = (name, ok) => { results.push({ name, ok }); console.log(ok ? 'ok  ' : 'FAIL', name) }

/* 1 — a click arms the guard and asks for the other scheme. */
setThemeCalls.length = 0
durable.preference = 'light'
click()
check('click asks for dark', setThemeCalls.length === 1 && setThemeCalls[0] === 'dark')

/* 2 — a bounce back to the replaced value re-issues the click. */
emitTheme('light')
await sleep(700)
check('bounce to the replaced value is re-issued', setThemeCalls.length === 2 && setThemeCalls[1] === 'dark')

/* 3 — a bounce to a third value is the user's own choice, not a lost write. */
setThemeCalls.length = 0
themeFace.preference = 'dark'
durable.preference = 'light'
click()
emitTheme('system')
await sleep(700)
check('bounce to a third value is left alone', setThemeCalls.length === 1)

/* 4 — a durable layer already holding the request stops the guard. */
setThemeCalls.length = 0
themeFace.preference = 'light'
durable.preference = 'light'
click()
durable.preference = 'dark'
emitTheme('light')
await sleep(700)
check('a durable write already holding the request stops the guard', setThemeCalls.length === 1)

/* 5 — a persistent refusal stops after the retry budget. */
setThemeCalls.length = 0
themeFace.preference = 'light'
durable.preference = 'light'
click()
// Every re-issue is answered by another bounce; the guard must give up.
for (let round = 0; round < 6; round += 1) {
  emitTheme('light')
  await sleep(300)
}
check('a persistent refusal stops retrying', setThemeCalls.length <= 4)

const failed = results.filter((row) => !row.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
console.log(failed.length === 0 ? 'PASS' : 'FAIL')
process.exit(failed.length === 0 ? 0 : 1)
