/**
 * Client half of `refresh-restart` (feature 8 of dsh-plugin-suite).
 *
 * ONE control, TWO different actions:
 *
 *  - **Refresh** reloads the page (`location.reload()`), exactly what the
 *    browser menu's reload does. The Host keeps running, sessions keep
 *    streaming, only the renderer is rebuilt.
 *  - **Restart** kills the desktop application and starts it again. That is the
 *    only way to load a changed Host half or profile patch: the Host is a child
 *    of the Electron process, and it has no way to replace itself — disposing
 *    it from inside makes Electron report a crash.
 *
 * WHY A MENU AND NOT TWO BUTTONS
 * The caption band already carries the menubar, the theme toggle and the window
 * controls; a second 28px control with the same glyph budget would read as one
 * control that does two things anyway. A popup also leaves room for the honest
 * state text ("仅桌面客户端支持", "正在重启…") that a bare button has nowhere to
 * put.
 *
 * PLACEMENT
 * Two seats, the same split the theme toggle uses:
 *
 *  - Windows desktop draws a caption band; the button is measured against the
 *    live `[data-windows-menu]` box exactly as `theme-toggle` does, and the
 *    theme button queues behind it because it already avoids this marker.
 *  - Everywhere else the button is a sidebar-foot action, ordered just before
 *    the theme toggle so the pair reads [refresh/restart][theme].
 *
 * The menu is portalled to `<body>` with a fixed position: the caption seat's
 * own box is a window-drag region, and the sidebar foot clips its children.
 */
window.__ModuleLoader__.load({
  id: '@local/refresh-restart',
  factory(require) {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement

    /** Host route: GET probes, POST restarts. */
    const PROBE_URL = '/plugins/plugin-suite/restart'
    /** Space between the caption menubar and this button. */
    const CAPTION_GAP = 8
    /** The preload's own fixed menubar host. */
    const MENU_SELECTOR = '[data-windows-menu]'
    /** Button box, needed to keep the control inside the caption. */
    const CONTROL_WIDTH = 28
    /** Popup width; fixed so the clamp below can be exact. */
    const MENU_WIDTH = 176
    /**
     * Re-measure points after any trigger, the same cadence `theme-toggle` uses:
     * the sidebar track animates for 150ms, so one measurement on the event
     * itself reads a half-finished layout.
     */
    const SETTLE_DELAYS = [0, 60, 140, 260, 420, 640]

    const COPY = {
      zh: {
        label: '刷新或重启',
        refresh: '刷新',
        restart: '重启 DSH',
        restartNote: '重启会中断正在运行的任务',
        browserOnly: '仅桌面客户端支持',
        notReady: '重启接口未加载，手动重启一次后可用',
        restarting: '正在重启…',
        failed: '重启失败',
        noExe: '没找到桌面端程序',
      },
      en: {
        label: 'Refresh or restart',
        refresh: 'Refresh',
        restart: 'Restart DSH',
        restartNote: 'Restarting stops running tasks',
        browserOnly: 'Desktop app only',
        notReady: 'Restart route not loaded; restart DSH once',
        restarting: 'Restarting…',
        failed: 'Restart failed',
        noExe: 'Desktop executable not found',
      },
    }

    function copyFor(localeId) {
      const id = String(localeId || '')
      return id === 'zh' || id.startsWith('zh-') ? COPY.zh : COPY.en
    }

    /* ------------------------------------------------------------ glyphs ---- */

    function RefreshIcon() {
      return h('svg', { viewBox: '0 0 24 24', width: 16, height: 16, 'aria-hidden': 'true' },
        h('g', { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' },
          h('path', { d: 'M20 12a8 8 0 1 1-2.34-5.66' }),
          h('path', { d: 'M20 4v4.5h-4.5' })));
    }

    function RestartIcon() {
      return h('svg', { viewBox: '0 0 24 24', width: 16, height: 16, 'aria-hidden': 'true' },
        h('g', { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' },
          h('path', { d: 'M12 3.4v8.2' }),
          h('path', { d: 'M7.1 6.3a7.6 7.6 0 1 0 9.8 0' })));
    }

    /* ------------------------------------------------------------- store ---- */

    /**
     * One shared snapshot for both seats and the popup.
     *
     * Only one seat is ever visible (`html[data-windows-titlebar]` picks), so a
     * single open-menu record is enough; `owner` keeps the clicked button's own
     * `aria-expanded` honest while the popup is drawn elsewhere.
     */
    const store = {
      /** open popup geometry, or `open: false` */
      menu: { open: false, owner: '', left: 0, top: 0, bottom: null, near: 'below' },
      /** desktop probe: whether a restart is possible at all */
      probe: { known: false, desktop: false, exe: null, error: undefined, routeMissing: false },
      /** 'idle' | 'running' | 'failed' */
      restart: 'idle',
      restartError: '',
      listeners: new Set(),
      /** the portal host; created with the first popup, removed on dispose */
      portal: null,
    }

    function emit() {
      for (const listener of [...store.listeners]) {
        try { listener() } catch (_error) { /* one broken seat must not stop the other */ }
      }
    }

    function subscribe(listener) {
      store.listeners.add(listener)
      return () => { store.listeners.delete(listener) }
    }

    /** Re-render on every store change. */
    function useStore() {
      const [, bump] = React.useState(0)
      React.useEffect(() => subscribe(() => bump(value => value + 1)), [])
    }

    /** Host faces captured in apply(); components read them at render time. */
    const services = { locale: undefined }

    /** The active language's copy. */
    function useCopy() {
      const [localeId, setLocaleId] = React.useState(() => {
        const locale = services.locale
        if (locale === undefined || typeof locale.getLocale !== 'function') return 'zh-CN'
        const current = locale.getLocale()
        return current && current.id ? current.id : 'zh-CN'
      })
      React.useEffect(() => {
        const ctx = services.ctx
        if (ctx === undefined || typeof ctx.on !== 'function') return undefined
        return ctx.on('locale/change', (next) => {
          setLocaleId(next && next.id ? next.id : 'zh-CN')
        })
      }, [])
      return copyFor(localeId)
    }

    /* ------------------------------------------------------------- probe ---- */

    /**
     * Ask the Host whether this page can restart the application.
     *
     * A missing route (an older suite, or a Host that failed to mount) is not an
     * error to shout about: it simply means the restart row stays disabled, and
     * the reason is kept for the tooltip.
     */
    async function probe() {
      try {
        const response = await fetch(PROBE_URL, {
          headers: { accept: 'application/json' },
          credentials: 'same-origin',
        })
        if (!response.ok) throw new Error(`probe ${response.status}`)
        const body = await response.json()
        const desktop = body !== null && typeof body === 'object' && body.desktop === true
        store.probe = {
          known: true,
          desktop,
          exe: body !== null && typeof body === 'object' && typeof body.exe === 'string' ? body.exe : null,
          error: undefined,
          routeMissing: false,
        }
      } catch (error) {
        // A missing route is not the same as "this is a browser": the Host half
        // only mounts on process start, so a freshly enabled feature answers 404
        // until DSH is restarted once. Say that instead of blaming the platform.
        store.probe = {
          known: true,
          desktop: false,
          exe: null,
          error: error instanceof Error ? error.message : String(error),
          routeMissing: true,
        }
      }
      emit()
    }

    /* -------------------------------------------------------------- menu ---- */

    /** Close the popup. */
    function closeMenu() {
      if (!store.menu.open) return
      store.menu = { open: false, owner: '', left: 0, top: 0, bottom: null, near: 'below' }
      store.restart = 'idle'
      store.restartError = ''
      emit()
    }

    /**
     * Open the popup under (or above) one button.
     * @param anchor - the clicked button.
     * @param owner - which seat opened it.
     * @param near - `below` in the caption band, `above` at the sidebar foot.
     */
    function openMenu(anchor, owner, near) {
      const rect = anchor.getBoundingClientRect()
      const viewport = typeof window.innerWidth === 'number' ? window.innerWidth : 0
      let left = Math.round(rect.left + rect.width / 2 - MENU_WIDTH / 2)
      if (viewport > 0) left = Math.max(8, Math.min(left, viewport - MENU_WIDTH - 8))
      const height = typeof window.innerHeight === 'number' ? window.innerHeight : 0
      store.menu = near === 'below'
        ? { open: true, owner, left, top: Math.round(rect.bottom + 6), bottom: null, near }
        : { open: true, owner, left, top: null, bottom: Math.round(height - rect.top + 6), near }
      store.restart = 'idle'
      store.restartError = ''
      emit()
      void probe()
    }

    /** Reload the page: the Host and every running session stay up. */
    function doRefresh() {
      closeMenu()
      window.location.reload()
    }

    /** Ask the Host to replace this application, then wait to be disconnected. */
    async function doRestart() {
      if (store.restart === 'running') return
      if (store.probe.desktop !== true) return
      store.restart = 'running'
      store.restartError = ''
      emit()
      try {
        const response = await fetch(PROBE_URL, {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: '{}',
        })
        if (!response.ok) {
          let detail = `HTTP ${response.status}`
          try {
            const body = await response.json()
            if (body !== null && typeof body === 'object' && typeof body.error === 'string') detail = body.error
          } catch (_error) { /* a non-JSON refusal keeps the status */ }
          throw new Error(detail)
        }
        /* The application is going away under us; leaving "正在重启…" on screen
           is the honest state until the window actually closes. */
      } catch (error) {
        store.restart = 'failed'
        store.restartError = error instanceof Error ? error.message : String(error)
        emit()
      }
    }

    /* --------------------------------------------------------- the popup ---- */

    /**
     * The popup itself, drawn through a portal so the caption's drag region and
     * the sidebar's clipping cannot reach it.
     * @returns the menu, or null while it is closed.
     */
    function MenuLayer() {
      useStore()
      const text = useCopy()
      const [node] = React.useState(() => {
        const div = document.createElement('div')
        div.className = 'psx-rr-layer'
        div.setAttribute('data-dsh-refresh-restart-menu', '')
        document.body.appendChild(div)
        store.portal = div
        return div
      })
      React.useEffect(() => () => {
        node.remove()
        if (store.portal === node) store.portal = null
      }, [node])

      const menu = store.menu
      if (!menu.open) return null

      const canRestart = store.probe.desktop === true
      const running = store.restart === 'running'
      const failed = store.restart === 'failed'
      const unavailable = store.probe.known && !canRestart
      const why = store.probe.routeMissing ? text.notReady : text.browserOnly

      const style = {
        left: `${menu.left}px`,
        width: `${MENU_WIDTH}px`,
        ...(menu.top === null
          ? { bottom: `${menu.bottom}px` }
          : { top: `${menu.top}px` }),
      }

      const row = (props) => h('button', {
        type: 'button',
        role: 'menuitem',
        className: `psx-rr-item${props.disabled ? ' is-disabled' : ''}`,
        disabled: props.disabled === true,
        title: props.hint,
        onClick: props.onClick,
      }, h('span', { className: 'psx-rr-glyph', 'aria-hidden': 'true' }, props.glyph),
        h('span', { className: 'psx-rr-text' }, props.label),
        props.side === undefined ? null : h('span', { className: 'psx-rr-side' }, props.side))

      return ReactDOM.createPortal(
        h('div', {
          className: 'psx-rr-menu',
          role: 'menu',
          'aria-label': text.label,
          style,
          onMouseDown: event => event.stopPropagation(),
        },
          row({
            label: text.refresh,
            glyph: h(RefreshIcon),
            disabled: running,
            onClick: doRefresh,
          }),
          h('div', { className: 'psx-rr-sep', role: 'separator' }),
          row({
            label: running ? text.restarting : text.restart,
            glyph: h(RestartIcon),
            disabled: running || !canRestart,
            hint: unavailable ? why : text.restartNote,
            side: unavailable ? why : undefined,
            onClick: () => { void doRestart() },
          }),
          failed
            ? h('div', { className: 'psx-rr-error', role: 'alert' }, text.failed, '：', store.restartError)
            : null,
          h('div', { className: 'psx-rr-note' }, text.restartNote)),
        node,
      )
    }

    /* --------------------------------------------------------- the button ---- */

    /**
     * One trigger, in either seat's shape.
     * @param props - `owner`, `near`, `shape` ('caption' | 'row' | 'rail').
     */
    function Trigger(props) {
      useStore()
      const text = useCopy()
      const ref = React.useRef(null)
      const owner = props.owner
      const expanded = store.menu.open && store.menu.owner === owner
      const glyph = h('span', { className: 'psx-rr-toggle-glyph', 'aria-hidden': 'true' }, h(RefreshIcon))
      const className = props.shape === 'caption'
        ? 'psx-rr-toggle psx-rr-toggle-caption'
        : props.shape === 'row'
          ? 'psx-rr-toggle psx-rr-toggle-row'
          : 'psx-rr-toggle psx-rr-toggle-rail'
      const children = props.shape === 'row'
        ? [glyph, h('span', { className: 'psx-rr-toggle-label' }, text.label)]
        : [glyph]
      return h('button', {
        ref,
        type: 'button',
        className,
        'aria-haspopup': 'menu',
        'aria-expanded': expanded ? 'true' : 'false',
        'aria-label': text.label,
        title: text.label,
        onClick() {
          if (expanded) { closeMenu(); return }
          if (ref.current === null) return
          openMenu(ref.current, owner, props.near)
        },
      }, ...children)
    }

    /* ------------------------------------------------ caption measurement ---- */

    /**
     * Left edge of the caption button, in viewport pixels.
     *
     * Measured, never a constant: the caption cluster moves when the sidebar
     * opens and collapses (`--dsh-windows-menu-start` flips 48px ↔ 84px), so a
     * frozen `left` lands correctly in one state and jams in the other. The
     * theme toggle does the same and then steps past this marker, which is what
     * puts the two buttons in a stable [refresh/restart][theme] order.
     * @returns the measured x, or null before the caption menubar is laid out.
     */
    function measureCaptionLeft() {
      const menu = document.querySelector(MENU_SELECTOR)
      if (menu === null || typeof menu.getBoundingClientRect !== 'function') return null
      const rect = menu.getBoundingClientRect()
      if (!(rect.width > 0)) return null
      let left = rect.right + CAPTION_GAP
      const viewport = typeof window.innerWidth === 'number' ? window.innerWidth : 0
      if (viewport > 0 && left + CONTROL_WIDTH > viewport) left = viewport - CONTROL_WIDTH - CAPTION_GAP
      return Math.round(left)
    }

    /** Follow the caption cluster as the sidebar opens and collapses. */
    function useCaptionLeft() {
      const [left, setLeft] = React.useState(() => measureCaptionLeft())

      React.useEffect(() => {
        let alive = true
        let timers = []
        let observer = null
        let mountObserver = null
        let resizeObserver = null
        let watchedMenu = null

        const apply = () => {
          if (!alive) return
          const next = measureCaptionLeft()
          setLeft((previous) => (previous === next ? previous : next))
        }

        const watchMenu = () => {
          if (typeof ResizeObserver !== 'function') return
          const menu = document.querySelector(MENU_SELECTOR)
          if (menu === null || menu === watchedMenu) return
          if (resizeObserver !== null) resizeObserver.disconnect()
          watchedMenu = menu
          resizeObserver = new ResizeObserver(apply)
          resizeObserver.observe(menu)
        }

        const schedule = () => {
          for (const timer of timers) window.clearTimeout(timer)
          timers = SETTLE_DELAYS.map((delay) => window.setTimeout(() => {
            watchMenu()
            apply()
          }, delay))
        }

        apply()
        watchMenu()
        schedule()
        window.addEventListener('resize', schedule)
        document.addEventListener('transitionend', schedule, true)
        document.addEventListener('click', schedule, true)
        window.addEventListener('keydown', schedule, true)
        if (typeof MutationObserver === 'function') {
          observer = new MutationObserver(schedule)
          observer.observe(document.body, {
            attributes: true,
            attributeFilter: ['data-sidebar-collapsed'],
            subtree: true,
          })
          mountObserver = new MutationObserver(() => {
            if (document.querySelector(MENU_SELECTOR) !== watchedMenu) schedule()
          })
          mountObserver.observe(document.body, { childList: true })
        }
        return () => {
          alive = false
          for (const timer of timers) window.clearTimeout(timer)
          if (observer !== null) observer.disconnect()
          if (mountObserver !== null) mountObserver.disconnect()
          if (resizeObserver !== null) resizeObserver.disconnect()
          window.removeEventListener('resize', schedule)
          document.removeEventListener('transitionend', schedule, true)
          document.removeEventListener('click', schedule, true)
          window.removeEventListener('keydown', schedule, true)
        }
      }, [])

      return left
    }

    /** Caption seat: places the button after the live menubar, not at a constant x. */
    function CaptionAnchor() {
      const left = useCaptionLeft()
      if (left === null) return null
      return h('div', {
        className: 'psx-rr-anchor',
        'data-dsh-refresh-restart': '',
        style: { left: `${left}px` },
      }, h(Trigger, { owner: 'caption', near: 'below', shape: 'caption' }))
    }

    /**
     * Sidebar-foot seat: a row while the column is wide, the rail icon once it
     * collapses, a drawer entry in drawer mode — the same three shapes the
     * theme toggle takes, so the foot keeps one rhythm.
     * @param props - `wide` from `sidebar.footer.action`.
     */
    function SidebarFootTrigger(props) {
      const wide = Boolean(props && props.wide)
      return h(Trigger, {
        owner: 'footer',
        near: 'above',
        shape: wide ? 'row' : 'rail',
      })
    }

    /* --------------------------------------------------------------- CSS ---- */

    const CSS = [
      // Caption band. The band is a window-drag region (AppFrame paints it as
      // .frame::before with -webkit-app-region: drag), so the anchor subtracts
      // itself exactly as the shipped menubar and the theme toggle do.
      '.psx-rr-anchor{position:fixed;z-index:40;',
      'top:calc((var(--dsh-windows-titlebar-height, 40px) - 28px) / 2);',
      'display:flex;align-items:center;height:28px;pointer-events:none;-webkit-app-region:no-drag;}',
      '.psx-rr-toggle{pointer-events:auto;display:inline-flex;align-items:center;justify-content:center;',
      'width:28px;height:28px;padding:0;border:0;border-radius:6px;background:transparent;',
      'color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;-webkit-app-region:no-drag;}',
      '.psx-rr-toggle:hover,.psx-rr-toggle[aria-expanded="true"]{',
      'background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}',
      '.psx-rr-toggle:focus-visible{outline:1px solid var(--dsw-alias-label-secondary);outline-offset:1px;}',
      'html[data-input-modality="pointer"] .psx-rr-toggle:focus-visible{outline-color:transparent;}',
      // Sidebar foot: the row matches the column's own navigation rows.
      '.psx-rr-toggle-row{width:100%;height:32px;justify-content:flex-start;gap:6px;padding:0 9px;',
      'border-radius:var(--dsw-radius-md);font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary);}',
      '.psx-rr-toggle-glyph{display:inline-flex;align-items:center;justify-content:center;flex:none;}',
      '.psx-rr-toggle-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.psx-rr-toggle-rail{width:36px;height:36px;border-radius:var(--dsw-radius-md);color:var(--dsw-alias-label-primary);}',
      // Exactly one seat is drawn, the same rule the theme toggle states.
      'html[data-windows-titlebar] .psx-rr-toggle.psx-rr-toggle-row,',
      'html[data-windows-titlebar] .psx-rr-toggle.psx-rr-toggle-rail{display:none;}',
      'html:not([data-windows-titlebar]) .psx-rr-anchor{display:none;}',
      // The popup. Its own layer is click-through until the menu exists, so it
      // cannot swallow a click meant for the app.
      '.psx-rr-layer{pointer-events:none;}',
      '.psx-rr-menu{position:fixed;z-index:2147483100;pointer-events:auto;',
      'padding:5px;border-radius:10px;font-size:13px;line-height:20px;',
      'background:var(--dsw-alias-bg-overlay,#2b2b2b);color:var(--dsw-alias-label-primary,#f2f2f2);',
      'border:0.5px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));',
      'box-shadow:0 12px 32px rgba(0,0,0,.36),0 2px 8px rgba(0,0,0,.24);',
      'display:flex;flex-direction:column;gap:1px;}',
      '.psx-rr-item{display:flex;align-items:center;gap:9px;width:100%;height:30px;padding:0 8px;',
      'border:0;border-radius:7px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;}',
      '.psx-rr-item:hover:not(.is-disabled),.psx-rr-item:focus-visible{',
      'background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.1));outline:none;}',
      '.psx-rr-item.is-disabled{opacity:.45;cursor:default;}',
      '.psx-rr-glyph{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex:none;}',
      '.psx-rr-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.psx-rr-side{flex:none;font-size:11px;color:var(--dsw-alias-label-secondary,#9a9a9a);}',
      '.psx-rr-sep{height:1px;margin:3px 4px;background:var(--dsw-alias-border-l1,rgba(255,255,255,.1));}',
      '.psx-rr-note{padding:2px 8px 3px;font-size:11px;line-height:16px;',
      'color:var(--dsw-alias-label-secondary,#9a9a9a);}',
      '.psx-rr-error{padding:2px 8px 4px;font-size:11px;line-height:16px;',
      'color:var(--dsw-alias-state-error-primary,#ff6b6b);}',
    ].join('')

    /* -------------------------------------------------------------- plugin ---- */

    return {
      inject: ['slots'],
      apply(ctx) {
        services.ctx = ctx
        services.locale = typeof ctx.get === 'function' ? ctx.get('locale') : undefined

        ctx.effect(() => {
          const style = document.createElement('style')
          style.setAttribute('data-dsh-refresh-restart-style', '')
          style.textContent = CSS
          document.head.appendChild(style)
          return () => style.remove()
        }, 'refresh-restart: styles')

        /** Dismiss on outside press, Escape, or a layout change that would strand it. */
        ctx.effect(() => {
          const onPointerDown = (event) => {
            if (!store.menu.open) return
            const target = event.target
            if (target instanceof Element && target.closest('[data-dsh-refresh-restart-menu]') !== null) return
            if (target instanceof Element && target.closest('[data-dsh-refresh-restart]') !== null) return
            if (target instanceof Element && target.closest('.psx-rr-toggle') !== null) return
            closeMenu()
          }
          const onKeyDown = (event) => {
            if (event.key === 'Escape' && store.menu.open) closeMenu()
          }
          const onResize = () => closeMenu()
          const onBlur = () => closeMenu()
          document.addEventListener('pointerdown', onPointerDown, true)
          window.addEventListener('keydown', onKeyDown, true)
          window.addEventListener('resize', onResize)
          window.addEventListener('blur', onBlur)
          return () => {
            document.removeEventListener('pointerdown', onPointerDown, true)
            window.removeEventListener('keydown', onKeyDown, true)
            window.removeEventListener('resize', onResize)
            window.removeEventListener('blur', onBlur)
          }
        }, 'refresh-restart: dismissal')

        // Caption placement (hidden by CSS everywhere else).
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'refresh-restart',
          order: 19,
          label: () => 'refresh-restart',
        }, CaptionAnchor))

        // The popup layer: mounted once, portals to <body> while open.
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'refresh-restart-menu',
        }, MenuLayer))

        // Sidebar-foot placement: ordered just before the theme toggle (10).
        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'refresh-restart',
          order: 9,
          label: () => 'refresh-restart',
        }, SidebarFootTrigger))

        // The theme toggle queues behind this marker by measuring it; it only
        // re-measures on its own triggers, so announce this seat's arrival once.
        if (typeof window.dispatchEvent === 'function') window.dispatchEvent(new Event('resize'))
        void probe()

        window.__dshRefreshRestart = {
          open: () => store.menu.open,
          probe: () => ({ ...store.probe }),
          close: closeMenu,
          refresh: doRefresh,
          restart: doRestart,
        }

        ctx.effect(() => () => {
          closeMenu()
          store.listeners.clear()
          if (store.portal !== null) {
            store.portal.remove()
            store.portal = null
          }
          delete window.__dshRefreshRestart
        }, 'refresh-restart: teardown')
      },
    }
  },
})
