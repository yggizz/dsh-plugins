// Harness for `features/client/sidebar-pins.raw.js`: proves the pin/unpin
// recognition on a DOM that mirrors the shipped markup.
//
// What it proves:
//   1. the sidebar row's unpin control is still recognized (no regression);
//   2. the More menu's pin control is recognized even though it sits one
//      wrapper deeper than its launcher — the old parentElement-only rule
//      missed it and the replay then kicked the launcher back into More;
//   3. after a pin, the replay pass does not click the unpin control again;
//   4. names match across extra whitespace (row aria-label vs menu text).
import fs from 'node:fs'
import path from 'node:path'

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const source = fs.readFileSync(path.join(here, '..', 'features', 'client', 'sidebar-pins.raw.js'), 'utf8')

/* ------------------------------------------------------------ tiny DOM ---- */

const ATTRIBUTE = /^\[\s*([\w-]+)\s*(?:=\s*"([^"]*)")?\s*\]$/u
const CLASS = /^\.([\w-]+)$/u
const COMPOUND = /^([a-z]*)((?:\[[^\]]*\]|\.[\w-]+)*)$/iu

/** Match one compound selector such as `button[role="menuitem"]` or `.pinAnchor`. */
function matchesCompound(node, compound) {
  const parts = compound.match(COMPOUND)
  if (parts === null) return false
  const [, tag, rest] = parts
  if (tag !== '' && node.tagName !== tag.toUpperCase()) return false
  for (const token of rest.match(/\[[^\]]*\]|\.[\w-]+/gu) ?? []) {
    const attribute = token.match(ATTRIBUTE)
    if (attribute !== null) {
      const actual = node.getAttribute(attribute[1])
      if (actual === null) return false
      if (attribute[2] !== undefined && actual !== attribute[2]) return false
      continue
    }
    const klass = token.match(CLASS)
    if (klass === null) return false
    if (!(node.getAttribute('class') ?? '').split(/\s+/u).includes(klass[1])) return false
  }
  return true
}

/** Match a descendant chain; the harness only ever uses selectors without spaces in values. */
function matches(node, selector) {
  const chain = selector.trim().split(/\s+/u)
  if (!matchesCompound(node, chain[chain.length - 1])) return false
  let index = chain.length - 2
  let cursor = node.parentElement
  while (index >= 0 && cursor !== null) {
    if (matchesCompound(cursor, chain[index])) index -= 1
    cursor = cursor.parentElement
  }
  return index < 0
}

class Node {
  constructor(tag, attributes = {}, text = '') {
    this.tagName = tag.toUpperCase()
    this.attributes = { ...attributes }
    this.ownText = text
    this.children = []
    this.parentElement = null
    this.clicks = 0
  }

  get textContent() {
    return this.ownText + this.children.map(child => child.textContent).join('')
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value)
  }

  append(...children) {
    for (const child of children) {
      child.parentElement = this
      this.children.push(child)
    }
    return this
  }

  /** Depth-first descendants, self excluded. */
  descendants() {
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

  querySelectorAll(selector) {
    return this.descendants().filter(node => matches(node, selector))
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null
  }

  closest(selector) {
    let node = this
    while (node !== null) {
      if (matches(node, selector)) return node
      node = node.parentElement
    }
    return null
  }

  click() {
    this.clicks += 1
  }

  blur() {}
}

const documentListeners = []
const documentBody = new Node('body')

globalThis.Element = Node
globalThis.MutationObserver = class {
  observe() {}
  disconnect() {}
}
globalThis.document = {
  body: documentBody,
  activeElement: null,
  cookie: '',
  head: { appendChild() {} },
  createElement: () => new Node('div'),
  querySelector: selector => documentBody.querySelector(selector),
  querySelectorAll: selector => documentBody.querySelectorAll(selector),
  addEventListener: (type, handler) => { documentListeners.push({ type, handler }) },
  removeEventListener: () => {},
}
globalThis.window = {
  __ModuleLoader__: { load: ({ factory }) => { globalThis.__factory = factory } },
  localStorage: {
    store: new Map(),
    getItem(key) { return this.store.has(key) ? this.store.get(key) : null },
    setItem(key, value) { this.store.set(key, value) },
    removeItem(key) { this.store.delete(key) },
  },
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: timer => clearTimeout(timer),
  innerWidth: 1440,
  addEventListener: () => {},
  removeEventListener: () => {},
}

/* ------------------------------------------------------- markup mirror ---- */

/** `<div class=panelEntry>` holding the launcher and its unpin control as siblings. */
function sidebarRow(name) {
  const launcher = new Node('button', { 'aria-label': name }, name)
  const unpin = new Node('button', { 'aria-label': `取消固定 ${name}` })
  const row = new Node('div', { class: 'panelEntry' })
  row.append(launcher, unpin)
  return { row, launcher, unpin }
}

/**
 * One More-menu entry, mirroring the shipped markup:
 * `<div class=sidebarEntry><div class=itemWrap><launcher/></div><span class=pinAnchor><pin/></span></div>`.
 */
function menuEntry(name) {
  const launcher = new Node('button', { role: 'menuitem' }, name)
  const launcherWrap = new Node('div', { class: 'itemWrap' }).append(launcher)
  const pin = new Node('button', { role: 'menuitem', 'aria-label': `将${name}固定到侧边栏` })
  const pinWrap = new Node('span', { class: 'pinAnchor' }).append(pin)
  const entry = new Node('div', { class: 'sidebarEntry' })
  entry.append(launcherWrap, pinWrap)
  return { entry, launcher, pin }
}

const nav = new Node('nav', {})
const scrollport = new Node('div', { 'data-sidebar-scrollport': '' })
scrollport.append(nav)
documentBody.append(scrollport)

const menu = new Node('div', { role: 'menu' })
const first = menuEntry('文件')
menu.append(first.entry)
documentBody.append(menu)

const firstRow = sidebarRow('文件')
nav.append(firstRow.row)

/* ----------------------------------------------------------------- run ---- */

new Function(source)()
globalThis.__factory().apply({ effect: fn => { fn(); return () => {} } })

const api = globalThis.window.__dshSidebarPins
const click = node => {
  for (const listener of documentListeners) {
    if (listener.type === 'click') listener.handler({ target: node })
  }
}

const checks = []
const check = (label, ok) => {
  checks.push({ label, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}`)
}

// 1. Unpinning from the sidebar row is still recognized.
click(firstRow.unpin)
check('sidebar unpin is recorded', api.list().includes('文件'))
check('replay clicked the unpin control once', firstRow.unpin.clicks === 1)

// 2. Pinning from the More menu is recognized (the old rule never saw it).
check('fixture mirrors the shipped nesting (pin is not the launcher\'s sibling)',
  first.pin.parentElement !== first.launcher.parentElement)
click(first.pin)
check('Menu pin is recognized', !api.list().includes('文件'))
check('Menu pin is remembered as pinned', api.pinned('文件'))

// 3. The replay pass must not put it back into More.
const before = firstRow.unpin.clicks
api.apply()
check('replay does not undo the pin', firstRow.unpin.clicks === before)

// 4. Whitespace differences do not break the match.
const second = sidebarRow('  报表   中心 ')
nav.append(second.row)
click(second.unpin)
check('names are normalized', api.list().includes('报表 中心'))

// 5. Pin then unpin then pin again: the quiet window is not a lock.
const third = menuEntry('报表   中心')
menu.append(third.entry)
click(third.pin)
check('pin after unpin works', !api.list().includes('报表 中心'))
click(second.unpin)
check('unpin after pin works', api.list().includes('报表 中心'))

const failed = checks.filter(entry => !entry.ok)
console.log(failed.length === 0
  ? `PASS: ${checks.length}/${checks.length} checks`
  : `FAIL: ${failed.length}/${checks.length} checks`)
process.exit(failed.length === 0 ? 0 : 1)
