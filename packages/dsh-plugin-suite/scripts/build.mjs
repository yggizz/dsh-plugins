// Build `client.js` for dsh-plugin-suite from the ten raw client sources.
//
// Each raw file is the original `window.__ModuleLoader__.load({ id, factory })`
// wrapper. This script keeps the factory BODY verbatim (zero edits) and turns it
// into an IIFE that returns the feature's plugin object, so the merged bundle can
// mount each feature as its own Cordis fiber and dispose it independently.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const dir = path.join(here, '..', 'features', 'client')
const out = path.join(here, '..', 'client.js')
const localeDir = path.join(here, '..', 'locale')

/** Order here is the order on the settings page. */
const FEATURES = [
  ['artifact-copy'],
  ['theme-toggle'],
  ['turn-credits'],
  ['hide-branch'],
  ['sidebar-pins'],
  ['rightbar-default-open'],
  ['archive-filter-toggle'],
  ['approval-zh'],
  ['restart-button'],
  ['session-search'],
]

/**
 * Strip the loader wrapper and return the module-level preamble plus the
 * factory body. A raw file may carry helpers above the loader call
 * (`hide-branch` keeps its label table and selector builder there), and those
 * belong inside the IIFE, before the body.
 * @param {string} source - the raw client file.
 * @param {string} name - feature name, for error messages.
 * @returns {{ preamble: string, body: string }} both halves, verbatim.
 */
function factoryBody(source, name) {
  const lines = source.split(/\r?\n/)
  const loader = lines.findIndex(line => /^\s*window\.__ModuleLoader__\.load\(/.test(line))
  if (loader < 0) throw new Error(`${name}: no loader call`)
  const start = lines.findIndex(line => /^\s*factory\s*\(/.test(line))
  if (start < 0) throw new Error(`${name}: no factory line`)
  let end = lines.length - 1
  while (end > start && lines[end].trim() === '') end -= 1
  const tail = lines[end].trim()
  if (tail !== '});' && tail !== '})') throw new Error(`${name}: unexpected tail ${JSON.stringify(tail)}`)
  end -= 1
  if (lines[end].trim() !== '},') throw new Error(`${name}: unexpected factory close ${JSON.stringify(lines[end])}`)
  end -= 1
  return {
    preamble: lines.slice(0, loader).join('\n').replace(/\s+$/, ''),
    body: lines.slice(start + 1, end + 1).join('\n'),
  }
}

/**
 * Flatten a nested dictionary into dotted keys, which is what `ctx.locale`
 * lookups use (`t('settings.title')`).
 * @param {unknown} value - nested dictionary.
 * @param {string} prefix - current key prefix.
 * @param {Record<string, string>} out - accumulator.
 * @returns {Record<string, string>} the flat dictionary.
 */
function flatten(value, prefix, out) {
  if (value === null || typeof value !== 'object') return out
  for (const [key, child] of Object.entries(value)) {
    const next = prefix === '' ? key : `${prefix}.${key}`
    if (child !== null && typeof child === 'object') flatten(child, next, out)
    else if (typeof child === 'string') out[next] = child
  }
  return out
}

const zh = flatten(JSON.parse(fs.readFileSync(path.join(localeDir, 'zh.json'), 'utf8')), '', {})
const en = flatten(JSON.parse(fs.readFileSync(path.join(localeDir, 'en.json'), 'utf8')), '', {})
// `meta.*` belongs to the plugin manager, not to the settings page dictionary.
const dict = source => Object.fromEntries(Object.entries(source).filter(([key]) => !key.startsWith('meta.')))

function ident(name) {
  return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
}

const blocks = []
for (const [name] of FEATURES) {
  const file = path.join(dir, `${name}.raw.js`)
  const { preamble, body } = factoryBody(fs.readFileSync(file, 'utf8'), name)
  blocks.push(`    /* ========================= ${name} ========================= */
    // Verbatim from features/client/${name}.raw.js (module preamble + factory body).
    const ${ident(name)} = (function (require) {
${preamble === '' ? '' : `${preamble}\n\n`}${body}
    })(require)`)
}

const header = `/**
 * dsh-plugin-suite 鈥?Client half.
 *
 * Ten independent small features in ONE bundle, each mountable and removable at
 * runtime, plus the Settings page that switches them.
 *
 * Every feature keeps its original factory body verbatim (see
 * \`features/client/*.raw.js\` and \`scripts/build.mjs\`): the loader wrapper is
 * replaced by an IIFE that receives the same \`require\`, so each one still
 * returns its own \`{ inject, apply(ctx) }\` plugin object. Mounting goes through
 * \`ctx.plugin()\`, which gives the feature a child Cordis fiber 鈥?every
 * \`ctx.effect\`, \`ctx.slots.inject\`, \`ctx.on\` and \`ctx.locale.register\` it
 * performs is owned by that fiber, so disposing the fiber removes all of it.
 * That is what makes a switch a real uninstall instead of a CSS hide.
 *
 * Switch state: the Host owns \`~/.dsh/plugin-suite.json\` and serves it on
 * \`/plugins/plugin-suite/state\`; this module keeps a localStorage mirror only so
 * the first frame after a reload mounts the right features without a flash. The
 * mirror is never authoritative 鈥?the Host document is.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-suite',
  factory(require) {
    const React = require('react')
    const h = React.createElement

${blocks.join('\n\n')}

    /** The switchable features, in settings-page order. */
    const FEATURES = [
${FEATURES.map(([name]) => `      { id: ${JSON.stringify(name)}, plugin: ${ident(name)} },`).join('\n')}
    ]

    /** Dictionaries, flattened to the dotted keys \`t()\` looks up. */
    const DICTIONARIES = {
      zh: ${JSON.stringify(dict(zh), null, 6).replace(/\n\s*}/g, '}').replace(/\n/g, '\n      ')},
      en: ${JSON.stringify(dict(en), null, 6).replace(/\n\s*}/g, '}').replace(/\n/g, '\n      ')},
    }

    /** localStorage mirror key; the Host document remains authoritative. */
    const MIRROR_KEY = 'dsh.plugin-suite.v1'
    /** The ten switchable features, by id, in page order. */
    const FEATURE_IDS = FEATURES.map(feature => feature.id)
    /** Settings page identity. */
    const SETTINGS_NS = 'plugin-suite'
    const SETTINGS_SLOT = 'settings.section'
    const SETTINGS_ORDER = 30
    /** Host state route. */
    const STATE_URL = '/plugins/plugin-suite/state'

    /** Switch document, mounted set, and the page's subscriptions. */
    const state = {
      /** feature id 鈫?enabled */
      enabled: Object.create(null),
      /** feature id 鈫?the Cordis fiber the feature runs on */
      mounted: new Map(),
      /** feature ids currently being written to the Host */
      busy: new Set(),
      /** settings-page subscribers */
      listeners: new Set(),
      /** whether the Host answered at least once */
      loaded: false,
      /** the last load/save error, for the page */
      error: undefined,
      /** the suite's own context, captured in apply */
      ctx: undefined,
    }

    /** Default every feature to enabled; the Host document overrides. */
    for (const { id } of FEATURES) state.enabled[id] = true

    function readMirror() {
      try {
        const raw = window.localStorage.getItem(MIRROR_KEY)
        if (raw === null) return
        const parsed = JSON.parse(raw)
        const features = parsed && parsed.features
        if (features === null || typeof features !== 'object') return
        for (const { id } of FEATURES) {
          if (typeof features[id] === 'boolean') state.enabled[id] = features[id]
        }
      } catch (_error) {
        /* A broken mirror is not a failure: the Host document still arrives. */
      }
    }

    function writeMirror() {
      try {
        window.localStorage.setItem(MIRROR_KEY, JSON.stringify({ version: 1, features: { ...state.enabled } }))
      } catch (_error) {
        /* Private mode or a full quota: the mirror is a nicety, not a requirement. */
      }
    }

    function notify() {
      for (const listener of [...state.listeners]) {
        try { listener() } catch (_error) { /* one broken row must not stop the others */ }
      }
    }

    /**
     * Mount one feature on its own fiber.
     * @param {string} id - feature id.
     */
    function mount(id) {
      if (state.mounted.has(id)) return
      const feature = FEATURES.find(candidate => candidate.id === id)
      const ctx = state.ctx
      if (feature === undefined || ctx === undefined) return
      try {
        const fiber = ctx.plugin({
          inject: feature.plugin.inject ?? [],
          apply: featureCtx => feature.plugin.apply(featureCtx),
        })
        state.mounted.set(id, fiber)
      } catch (error) {
        state.error = error instanceof Error ? error.message : String(error)
        console.warn('[plugin-suite] mount failed:', id, error)
      }
    }

    /**
     * Dispose one feature's fiber, which releases every effect it registered.
     * @param {string} id - feature id.
     */
    function unmount(id) {
      const fiber = state.mounted.get(id)
      if (fiber === undefined) return
      state.mounted.delete(id)
      try {
        fiber.dispose()
      } catch (error) {
        console.warn('[plugin-suite] unmount failed:', id, error)
      }
    }

    /**
     * Apply one feature's switch locally.
     * @param {string} id - feature id.
     * @param {boolean} enabled - desired state.
     */
    function applySwitch(id, enabled) {
      state.enabled[id] = enabled
      if (enabled) mount(id)
      else unmount(id)
      writeMirror()
      notify()
    }

    /** Mount every feature the current document enables. */
    function mountEnabled() {
      for (const { id } of FEATURES) if (state.enabled[id] === true) mount(id)
    }

    /** Read the Host document and reconcile the mounted set with it. */
    async function load() {
      let body
      try {
        const response = await fetch(STATE_URL, { headers: { accept: 'application/json' }, credentials: 'same-origin' })
        if (!response.ok) throw new Error(\`state \${response.status}\`)
        body = await response.json()
      } catch (error) {
        state.error = error instanceof Error ? error.message : String(error)
        notify()
        return
      }
      const features = body && body.features
      if (features !== null && typeof features === 'object') {
        for (const { id } of FEATURES) {
          const next = typeof features[id] === 'boolean' ? features[id] : state.enabled[id]
          state.enabled[id] = next
          if (next === true) mount(id)
          else unmount(id)
        }
      }
      state.loaded = true
      state.error = undefined
      writeMirror()
      notify()
    }

    /**
     * Write one switch to the Host, then apply it locally.
     * @param {string} id - feature id.
     * @param {boolean} enabled - desired state.
     */
    async function setSwitch(id, enabled) {
      const previous = state.enabled[id]
      // Optimistic: the switch must feel instant, and a failure rolls this back.
      state.enabled[id] = enabled
      state.busy.add(id)
      notify()
      try {
        const response = await fetch(STATE_URL, {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ id, enabled }),
        })
        if (!response.ok) throw new Error(\`save \${response.status}\`)
        await response.json()
        state.error = undefined
      } catch (error) {
        state.enabled[id] = previous
        state.error = error instanceof Error ? error.message : String(error)
        state.busy.delete(id)
        notify()
        throw error
      }
      state.busy.delete(id)
      applySwitch(id, enabled)
    }

    /**
     * Set every switch at once.
     * @param {boolean} enabled - desired state for all features.
     */
    async function setAll(enabled) {
      for (const { id } of FEATURES) state.busy.add(id)
      notify()
      try {
        const response = await fetch(STATE_URL, {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ all: enabled }),
        })
        if (!response.ok) throw new Error(\`save \${response.status}\`)
        await response.json()
        state.error = undefined
      } catch (error) {
        state.error = error instanceof Error ? error.message : String(error)
        state.busy.clear()
        notify()
        return
      }
      for (const { id } of FEATURES) {
        state.busy.delete(id)
        applySwitch(id, enabled)
      }
    }

    /* ------------------------------------------------------------ settings ---- */

    /** Row styles, all on host tokens so a theme change carries them. */
    const CSS = [
      '.psx-page{display:flex;flex-direction:column;gap:14px;font-size:13px;}',
      '.psx-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;}',
      '.psx-title{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary);}',
      '.psx-sub{color:var(--dsw-alias-label-secondary);margin-top:2px;}',
      '.psx-actions{display:flex;gap:8px;flex:none;}',
      '.psx-btn{height:28px;padding:0 10px;border-radius:var(--dsw-radius-md,8px);cursor:pointer;font:inherit;',
      'border:0.5px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));background:var(--dsw-specific-input-major,rgba(128,128,128,.06));',
      'color:var(--dsw-alias-label-primary);}',
      '.psx-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12));}',
      '.psx-btn:disabled{opacity:.5;cursor:default;}',
      '.psx-list{display:flex;flex-direction:column;border-radius:var(--dsw-radius-panel,12px);',
      'border:0.5px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));overflow:hidden;}',
      '.psx-row{display:flex;align-items:flex-start;gap:12px;padding:12px 14px;}',
      '.psx-row+.psx-row{border-top:0.5px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));}',
      '.psx-row-main{flex:1;min-width:0;}',
      '.psx-row-title{color:var(--dsw-alias-label-primary);font-weight:500;}',
      '.psx-row-desc{color:var(--dsw-alias-label-secondary);margin-top:2px;line-height:18px;}',
      '.psx-row-side{flex:none;display:flex;align-items:center;gap:8px;padding-top:2px;}',
      '.psx-note{color:var(--dsw-alias-label-secondary);font-size:12px;}',
      '.psx-err{color:var(--dsw-alias-label-error,#d33);font-size:12px;}',
      '.psx-sw{position:relative;display:inline-flex;width:34px;height:20px;flex:none;}',
      '.psx-sw input{position:absolute;opacity:0;width:100%;height:100%;margin:0;cursor:pointer;}',
      '.psx-track{width:34px;height:20px;border-radius:999px;background:var(--dsw-alias-fill-tertiary,rgba(128,128,128,.35));',
      'transition:background .15s ease;pointer-events:none;}',
      '.psx-thumb{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:999px;background:#fff;',
      'transition:transform .15s ease;box-shadow:0 1px 2px rgba(0,0,0,.25);pointer-events:none;}',
      '.psx-sw input:checked~.psx-track{background:var(--dsw-alias-fill-accent,#3f6fd8);}',
      '.psx-sw input:checked~.psx-thumb{transform:translateX(14px);}',
      '.psx-sw input:disabled{cursor:default;}',
      '.psx-sw input:disabled~.psx-track{opacity:.5;}',
      '.psx-sw input:focus-visible~.psx-track{outline:1px solid var(--dsw-alias-label-secondary);outline-offset:2px;}',
    ].join('')

    /** The settings page. */
    function SuiteSettings({ t }) {
      const [, force] = React.useState(0)
      React.useEffect(() => {
        const listener = () => force(value => value + 1)
        state.listeners.add(listener)
        return () => { state.listeners.delete(listener) }
      }, [])
      const label = key => t(\`settings.features.\${key}.title\`)
      const describe = key => t(\`settings.features.\${key}.description\`)
      const allOn = FEATURES.every(feature => state.enabled[feature.id] === true)
      const allOff = FEATURES.every(feature => state.enabled[feature.id] !== true)
      return h('div', { className: 'psx-page' },
        h('div', { className: 'psx-head' },
          h('div', null,
            h('div', { className: 'psx-title' }, t('settings.title')),
            h('div', { className: 'psx-sub' }, t('settings.subtitle'))),
          h('div', { className: 'psx-actions' },
            h('button', {
              type: 'button', className: 'psx-btn', disabled: allOn || state.busy.size > 0,
              onClick: () => { void setAll(true) },
            }, t('settings.enableAll')),
            h('button', {
              type: 'button', className: 'psx-btn', disabled: allOff || state.busy.size > 0,
              onClick: () => { void setAll(false) },
            }, t('settings.disableAll')))),
        h('div', { className: 'psx-list' },
          ...FEATURES.map(feature => {
            const on = state.enabled[feature.id] === true
            const busy = state.busy.has(feature.id)
            return h('div', { className: 'psx-row', key: feature.id },
              h('div', { className: 'psx-row-main' },
                h('div', { className: 'psx-row-title' }, label(feature.id)),
                h('div', { className: 'psx-row-desc' }, describe(feature.id))),
              h('div', { className: 'psx-row-side' },
                busy ? h('span', { className: 'psx-note' }, t('settings.busy')) : null,
                h('span', { className: 'psx-sw' },
                  h('input', {
                    type: 'checkbox',
                    checked: on,
                    disabled: busy,
                    'aria-label': label(feature.id),
                    onChange: event => {
                      const next = event.currentTarget.checked
                      setSwitch(feature.id, next).catch(() => {})
                    },
                  }),
                  h('span', { className: 'psx-track' }),
                  h('span', { className: 'psx-thumb' }))))
          })),
        state.error === undefined ? null
          : h('div', { className: 'psx-err', role: 'alert' },
            state.loaded ? t('settings.saveFailed') : t('settings.loadFailed'), ' ', state.error),
        h('div', { className: 'psx-note' }, t('settings.saved'), ' ~/.dsh/plugin-suite.json'))
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        state.ctx = ctx
        ctx.effect(() => ctx.locale.register(SETTINGS_NS, DICTIONARIES), 'plugin-suite: copy')
        const t = ctx.locale.bind(SETTINGS_NS)
        ctx.effect(() => {
          const style = document.createElement('style')
          style.setAttribute('data-dsh-plugin-suite', '')
          style.textContent = CSS
          document.head.appendChild(style)
          return () => style.remove()
        }, 'plugin-suite: styles')
        // The slot is declared by ui-settings, whose activation order relative to
        // this one is not constrained: wait for it instead of registering early.
        ctx.slots.inject(SETTINGS_SLOT, () => ctx.slots.register({
          name: SETTINGS_SLOT,
          id: SETTINGS_NS,
          order: SETTINGS_ORDER,
          label: () => t('settings.nav'),
          inject: () => ({ t }),
        }, SuiteSettings))
        readMirror()
        mountEnabled()
        void load()
        // A diagnostic handle, the same way the other local plugins expose one:
        // lets a console (or a harness) read the switch document and flip one
        // feature without going through the Settings page.
        window.__dshPluginSuite = {
          features: FEATURE_IDS,
          enabled: () => ({ ...state.enabled }),
          mounted: () => [...state.mounted.keys()],
          error: () => state.error,
          set: (id, enabled) => setSwitch(id, enabled),
          setAll,
          reload: load,
        }
        ctx.effect(() => () => {
          for (const { id } of FEATURES) unmount(id)
          state.listeners.clear()
          delete window.__dshPluginSuite
        }, 'plugin-suite: features')
      },
    }
  },
})
`

fs.writeFileSync(out, header, 'utf8')
console.log('wrote', out, fs.statSync(out).size, 'B')

