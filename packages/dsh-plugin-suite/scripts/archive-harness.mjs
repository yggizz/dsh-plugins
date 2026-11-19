// DOM harness for dsh-plugin-suite's `archive-filter-toggle` feature.
//
// What it proves, against a hand-rolled fake DOM that mirrors the shipped
// Workspace header (`[data-sidebar-workspace-header] > label, searchSlot,
// headerActions`) and the shipped view-options menu:
//   1. the wrapper is inserted as the header child immediately before the slot
//      that holds the search input — i.e. in the free gap left of the search;
//   2. nothing is inserted in the collapsed rail, which draws no search input;
//   3. one click moves «hidden» -> «archived only», the next moves it back:
//      the two-state cycle the owner asked for;
//   4. the persisted filter (`dsh.workspace.view.v5`) is the source of truth for
//      both the filter and the glyph;
//   5. a shell re-render that drops the wrapper is repaired, and only once;
//   6. disposing the fiber removes the wrapper, the style tag and the overlay.
import fs from 'node:fs'
import path from 'node:path'

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const source = fs.readFileSync(path.join(here, '..', 'client.js'), 'utf8')

/* ------------------------------------------------------------- fake DOM ---- */

class FakeNode {
  constructor(tag, attrs) {
    this.tagName = String(tag).toUpperCase()
    this.attrs = attrs || {}
    this.children = []
    this.parentElement = null
    this.dataset = {}
    this.style = {}
    this.textContent = ''
    this._html = ''
    this._listeners = new Map()
    this.isConnected = false
  }

  get className() { return this.attrs.class || '' }
  set className(value) { this.attrs.class = value }

  setAttribute(name, value) { this.attrs[name] = String(value) }  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null
  }
  removeAttribute(name) { delete this.attrs[name] }

  set innerHTML(value) {
    this._html = String(value)
    this.attrs['data-has-svg'] = this._html.includes('<svg') ? 'yes' : 'no'
  }
  get innerHTML() { return this._html }

  appendChild(child) {
    child.parentElement = this
    child.isConnected = true
    this.children.push(child)
    return child
  }

  insertBefore(child, anchor) {
    const index = this.children.indexOf(anchor)
    child.parentElement = this
    child.isConnected = true
    if (index < 0) this.children.push(child)
    else this.children.splice(index, 0, child)
    return child
  }

  remove() {
    if (this.parentElement !== null) {
      const index = this.parentElement.children.indexOf(this)
      if (index >= 0) this.parentElement.children.splice(index, 1)
    }
    this.parentElement = null
    this.isConnected = false
  }

  addEventListener(type, handler) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set())
    this._listeners.get(type).add(handler)
  }

  removeEventListener(type, handler) {
    const set = this._listeners.get(type)
    if (set !== undefined) set.delete(handler)
  }

  click() {
    const set = this._listeners.get('click')
    if (set === undefined) return
    for (const handler of [...set]) handler({ preventDefault() {}, stopPropagation() {}, target: this })
  }

  all() {
    const out = []
    const walk = node => {
      for (const child of node.children) {
        out.push(child)
        walk(child)
      }
    }
    walk(this)
    return out
  }

  matches(selector) {
    switch (selector) {
      case 'button': return this.tagName === 'BUTTON'
      case 'input[type="text"]': return this.tagName === 'INPUT' && this.attrs.type === 'text'
      case '[role="menu"]': return this.attrs.role === 'menu'
      case 'button[role="menuitem"]': return this.tagName === 'BUTTON' && this.attrs.role === 'menuitem'
      case '[data-sidebar-workspace-header]':
        return Object.prototype.hasOwnProperty.call(this.attrs, 'data-sidebar-workspace-header')
      case '[data-psx-archive-toggle]':
        return Object.prototype.hasOwnProperty.call(this.attrs, 'data-psx-archive-toggle')
      case '[data-dsh-archive-filter-toggle]':
        return Object.prototype.hasOwnProperty.call(this.attrs, 'data-dsh-archive-filter-toggle')
      case 'style':
        return this.tagName === 'STYLE'
      default: return false
    }
  }

  querySelector(selector) {
    for (const node of this.all()) if (node.matches(selector)) return node
    return null
  }

  querySelectorAll(selector) {
    return this.all().filter(node => node.matches(selector))
  }
}

const head = new FakeNode('head')
const body = new FakeNode('body')
body.isConnected = true

const storage = new Map()
const storeListeners = new Set()

function readFilter() {
  const raw = storage.get('dsh.workspace.view.v5')
  if (raw === undefined) return undefined
  const parsed = JSON.parse(raw)
  return parsed.archivedFilter
}

function writeFilter(value) {
  const current = JSON.parse(storage.get('dsh.workspace.view.v5') || '{}')
  current.archivedFilter = value
  storage.set('dsh.workspace.view.v5', JSON.stringify(current))
}

const documentStub = {
  head,
  body,
  documentElement: body,
  activeElement: null,
  createElement: tag => new FakeNode(tag),
  querySelector: selector => body.querySelector(selector),
  querySelectorAll: selector => body.querySelectorAll(selector),
  addEventListener() {},
  removeEventListener() {},
}

/* ------------------------------------------------------- the shipped UI ---- */

function buildWideHeader() {
  const header = new FakeNode('div', { 'data-sidebar-workspace-header': '' })
  body.appendChild(header)

  const label = new FakeNode('span')
  label.textContent = '工作区'
  header.appendChild(label)

  const searchSlot = new FakeNode('div', { class: 'searchSlot' })
  header.appendChild(searchSlot)
  const searchBox = new FakeNode('div', { class: 'search' })
  searchSlot.appendChild(searchBox)
  searchSlot.appendChild(new FakeNode('button', { 'aria-label': '搜索会话' }))
  searchBox.appendChild(new FakeNode('input', { type: 'text', tabindex: '0' }))

  const actions = new FakeNode('div', { class: 'headerActions' })
  header.appendChild(actions)
  const viewOptions = new FakeNode('button', { 'aria-label': '视图选项' })
  actions.appendChild(viewOptions)
  actions.appendChild(new FakeNode('button', { 'aria-label': '添加工作区' }))

  viewOptions.addEventListener('click', () => {
    if (body.querySelector('[role="menu"]') !== null) return
    const menu = new FakeNode('div', { role: 'menu' })
    body.appendChild(menu)
    for (const [index, text] of ['隐藏已归档', '全部对话（显示已归档）', '仅显示已归档'].entries()) {
      const item = new FakeNode('button', { role: 'menuitem' })
      item.textContent = text
      item.addEventListener('click', () => {
        writeFilter(['default', 'show', 'only'][index])
        menu.remove()
        for (const listener of [...storeListeners]) listener()
      })
      menu.appendChild(item)
    }
  })
  return { header, searchSlot, actions }
}

function buildRailHeader() {
  const header = new FakeNode('div', { 'data-sidebar-workspace-header': '' })
  body.appendChild(header)
  header.appendChild(new FakeNode('button', { 'aria-label': '搜索会话' }))
  header.appendChild(new FakeNode('button', { 'aria-label': '添加工作区' }))
  return { header }
}

/* -------------------------------------------------------------- globals ---- */

globalThis.window = {
  __ModuleLoader__: { load: ({ factory }) => { capturedFactory = factory } },
  localStorage: {
    getItem: key => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key),
  },
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: id => clearTimeout(id),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: id => clearInterval(id),
  addEventListener: (type, handler) => { if (type === 'storage') storeListeners.add(handler) },
  removeEventListener: (type, handler) => { if (type === 'storage') storeListeners.delete(handler) },
  innerWidth: 1440,
}
globalThis.document = documentStub
/** A MutationObserver stub that records live observers so the test can flush them. */
const observers = new Set()
globalThis.MutationObserver = class {
  constructor(callback) { this.callback = callback; this.observed = false }
  observe() { this.observed = true; observers.add(this) }
  disconnect() { this.observed = false; observers.delete(this) }
}
/** Deliver one DOM-mutation burst, the way the browser would. */
const flushMutations = () => {
  for (const observer of [...observers]) if (observer.observed) observer.callback([])
}
let capturedFactory

/* ---------------------------------------------------------------- stubs ---- */

const React = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  useState: init => [typeof init === 'function' ? init() : init, () => {}],
  useEffect: () => {},
  useRef: init => ({ current: init }),
  useCallback: fn => fn,
  useMemo: fn => fn(),
  Fragment: 'Fragment',
}
/** A minimal react-dom: the bundle only portals/tests ids through it. */
const ReactDOM = {
  createPortal: (node) => node,
  flushSync: (fn) => fn(),
}

const live = { effects: 0, slots: 0 }
/** Slot ids registered RIGHT NOW, so one feature's contribution is checkable. */
const liveIds = []
const liveCount = id => liveIds.filter(value => value === id).length

/** Build one Cordis-like context whose cleanups land in `own`. */
function makeCtx(own) {
  const ctx = {
    effect(fn) {
      live.effects += 1
      const off = fn()
      own.push(() => { live.effects -= 1; if (typeof off === 'function') off() })
      return () => {}
    },
    on() { return () => {} },
    inject(_deps, callback) { callback(ctx); return () => {} },
    get(name) {
      if (name !== 'locale') return undefined
      return { getLocale: () => ({ id: 'zh-CN' }), register: () => () => {}, bind: () => key => key }
    },
    locale: { getLocale: () => ({ id: 'zh-CN' }), register: () => () => {}, bind: () => key => key },
    contextMenus: {
      register() { return () => {} },
      active: { getSnapshot: () => null, subscribe: () => () => {} },
    },
    theme: { getTheme: () => null, setTheme: () => {} },
    /** Child fibers: what the suite uses to mount one feature on its own lifetime. */
    plugin(definition) {
      const own = []
      const fiber = {
        disposed: false,
        ctx: makeCtx(own),
        dispose() {
          if (fiber.disposed) return
          fiber.disposed = true
          while (own.length > 0) own.pop()()
        },
      }
      definition.apply(fiber.ctx)
      return fiber
    },
    slots: {
      inject(_slot, callback) { return callback() },
      register(options) {
        live.slots += 1
        const id = options.id ?? options.name
        liveIds.push(id)
        const drop = () => {
          const index = liveIds.indexOf(id)
          if (index >= 0) liveIds.splice(index, 1)
          live.slots -= 1
        }
        own.push(drop)
        return drop
      },
    },
  }
  return ctx
}

/** The suite's own root context: it owns no feature and stays alive throughout. */
const rootOwn = []
const rootCtx = makeCtx(rootOwn)
/* The suite half also registers its dictionaries and its settings page. */
rootCtx.locale = { register: () => () => {}, bind: () => key => key, getLocale: () => ({ id: 'zh-CN' }) }
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, features: {} }) })
rootCtx.plugin = definition => {
  const own = []
  const fiber = {
    disposed: false,
    dispose() {
      if (fiber.disposed) return
      fiber.disposed = true
      while (own.length > 0) own.pop()()
    },
  }
  definition.apply(makeCtx(own))
  return fiber
}

const settle = () => new Promise(resolve => setTimeout(resolve, 260))
const checks = []
const check = (name, ok, detail) => {
  checks.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : ` — ${detail}`}`)
}

/* ------------------------------------------------------------------ run ---- */

new Function(source)()
const plugin = capturedFactory(name => {
  if (name === 'react') return React
  if (name === 'react-dom') return ReactDOM
  throw new Error(`unexpected require: ${name}`)
})

writeFilter('default')
const wide = buildWideHeader()
/* Mount the whole suite the way the loader does, then pick the one feature's fiber. */
const suiteFiber = rootCtx.plugin({ inject: [], apply: c => plugin.apply(c) })
await settle()
await settle()
void suiteFiber

const wrapper = wide.header.children.find(node => node.attrs.class === 'psx-archive-slot')
check('wrapper inserted into the header', wrapper !== undefined)
const button = wrapper?.children[0]
const slotIndex = wide.header.children.indexOf(wide.searchSlot)
check('wrapper sits immediately before the search slot',
  wrapper !== undefined && wide.header.children.indexOf(wrapper) === slotIndex - 1,
  `wrapper ${wide.header.children.indexOf(wrapper)} / slot ${slotIndex}`)
check('button carries its own hook class', button?.attrs.class === 'psx-archive-btn')
check('initial state is "hide"', button?.dataset.state === 'hide', button?.dataset.state)
check('initial glyph is drawn', button?.attrs['data-has-svg'] === 'yes')
check('the feature registered its own overlay slot',
  liveCount('plugin-suite-archive-toast') === 1,
  liveIds.join(', '))

button.click()
await settle()
await settle()
check('click 1 moved the filter to archived-only', readFilter() === 'only', String(readFilter()))
check('glyph followed the filter', button.dataset.state === 'only', button.dataset.state)
check('menu closed after the selection', body.querySelector('[role="menu"]') === null)

button.click()
await settle()
await settle()
check('click 2 returned to hide-archived', readFilter() === 'default', String(readFilter()))
check('glyph returned to "hide"', button.dataset.state === 'hide', button.dataset.state)

wrapper.remove()
flushMutations()
await settle()
await settle()
const repaired = wide.header.children.filter(node => node.attrs.class === 'psx-archive-slot')
check('dropped wrapper re-inserted exactly once', repaired.length === 1, `${repaired.length} wrapper(s)`)

wide.header.remove()
const rail = buildRailHeader()
await settle()
await settle()
check('collapsed rail receives no button',
  rail.header.children.every(node => node.attrs.class !== 'psx-archive-slot'),
  `${rail.header.children.length} child(ren)`)

const beforeSlots = live.slots
await globalThis.window.__dshPluginSuite.set('archive-filter-toggle', false)
await settle()
check('switching the feature off removed its overlay registration',
  liveCount('plugin-suite-archive-toast') === 0 && live.slots === beforeSlots - 1,
  `${beforeSlots} -> ${live.slots}; ids=${liveIds.join(', ')}`)
check('switching it off left no wrapper in the rail',
  rail.header.children.every(node => node.attrs.class !== 'psx-archive-slot'))
check('switching it off removed the style tag', head.querySelector('[data-dsh-archive-filter-toggle]') === null)
check('switching it off removed the diagnostic handle', globalThis.window.__dshArchiveFilterToggle === undefined)

await globalThis.window.__dshPluginSuite.set('archive-filter-toggle', true)
await settle()
await settle()
check('switching it back on registered its overlay again',
  liveCount('plugin-suite-archive-toast') === 1,
  liveIds.join(', '))
wide.header.remove()
body.appendChild(wide.header)
flushMutations()
await settle()
await settle()
check('re-enabled feature re-inserts into the wide header',
  wide.header.children.some(node => node.attrs.class === 'psx-archive-slot'))

const failed = checks.filter(entry => !entry.ok)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
console.log(failed.length === 0 ? 'PASS' : 'FAIL')
process.exit(failed.length === 0 ? 0 : 1)
