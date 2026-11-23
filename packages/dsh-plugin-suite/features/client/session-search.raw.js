/**
 * Search inside the current Session — Client half.
 *
 * ONE seat: `conversation.session.header.utilities` — the right-aligned list of
 * Session utilities, where this button sits just left of the "…" menu. The
 * `conversation.session.header.corner` seat is NOT used on purpose: the shipped
 * right Sidebar's expand button owns that single slot, and registering there
 * replaced it (the toggle vanished from the header). The button toggles a small
 * panel with an input, a match counter, and previous/next.
 *
 * WHAT IT SEARCHES
 * DSH renders the loaded part of a Session into the Chat flow, but exposes no
 * Client face that hands out message text: `ctx.conversation` is send/cancel/
 * queue, `ctx.sessions` is lifecycle and cross-session search. So this searches
 * the rendered conversation of THIS Session only — the region marked
 * `[data-conversation-region="chat"]` whose `data-conversation-session` matches
 * the header's Session — and nothing outside it (composer, sidebars, header).
 * Older history that has not been paged into the DOM yet is not searched; the
 * empty state says so instead of pretending there is no match anywhere.
 *
 * HOW A MATCH IS SHOWN
 * Ranges are collected with a TreeWalker over that region's text nodes and
 * painted with the CSS Custom Highlight API (`::highlight()`), which needs no
 * DOM mutation and therefore does not fight React. Text inside `aria-hidden`
 * or otherwise zero-size nodes (screen-reader labels) is skipped. When the API
 * is unavailable the current match is selected natively instead.
 *
 * KEYBOARD
 * Ctrl/⌘+F opens the panel and focuses the field (this machine's GUI has no
 * built-in find-in-page); Enter and Shift+Enter walk matches forward/back, and
 * Escape closes the panel and clears the paint.
 */
window.__ModuleLoader__.load({
  id: '@local/session-search',
  factory(require) {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement

    const NS = 'sessionSearch'
    const SLOT = 'conversation.session.header.utilities'
    const OPEN_EVENT = 'dsh-session-search:open'
    const ALL_HIGHLIGHT = 'dsh-session-search-all'
    const CURRENT_HIGHLIGHT = 'dsh-session-search-current'
    const MARK_ATTR = 'data-dsh-session-search'
    /** Upper bound on painted ranges: a pathologically broad query must not freeze the tab. */
    const MAX_MATCHES = 2000
    /** Typing settles before the DOM is walked again. */
    const SCAN_DELAY_MS = 140

    const zh = {
      'action': '会话内搜索',
      'hint.open': '在当前会话里搜索关键字（Ctrl/⌘+F）',
      'placeholder': '搜索当前会话',
      'idle': '输入关键字：Enter 下一个，Shift+Enter 上一个',
      'none': '当前已加载的对话里没有匹配',
      'prev': '上一个',
      'next': '下一个',
      'close': '关闭',
    }

    const en = {
      'action': 'Search this session',
      'hint.open': 'Find a keyword in this session (Ctrl/⌘+F)',
      'placeholder': 'Search this session',
      'idle': 'Type a keyword: Enter next, Shift+Enter previous',
      'none': 'No match in the conversation loaded so far',
      'prev': 'Previous',
      'next': 'Next',
      'close': 'Close',
    }

    const STYLES = [
      '.ssr-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;',
      'border:0;background:transparent;border-radius:var(--dsw-radius-md,8px);cursor:pointer;',
      'color:var(--dsw-alias-label-secondary);-webkit-app-region:no-drag}',
      '@media (hover:hover){.ssr-btn:hover{background-color:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12));',
      'color:var(--dsw-alias-label-primary)}}',
      '.ssr-btn[data-open="true"]{background-color:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12));',
      'color:var(--dsw-alias-label-primary)}',
      '.ssr-btn:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid ',
      'var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:-2px}',
      '.ssr-panel{position:fixed;z-index:2147483000;width:344px;display:flex;flex-direction:column;gap:8px;',
      'box-sizing:border-box;padding:10px;border-radius:var(--dsw-radius-panel,12px);',
      'background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-2,#fff));',
      'border:.5px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));box-shadow:0 10px 30px rgba(0,0,0,.2);',
      'color:var(--dsw-alias-label-primary);font-size:13px;line-height:18px}',
      '.ssr-row{display:flex;align-items:center;gap:6px}',
      '.ssr-input{flex:1;min-width:0;height:30px;box-sizing:border-box;padding:0 8px;border-radius:8px;',
      'border:.5px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));',
      'background:var(--dsw-specific-input-major,rgba(128,128,128,.06));color:inherit;font:inherit;outline:none}',
      '.ssr-input:focus{border-color:var(--dsw-alias-brand-primary)}',
      '.ssr-count{flex:none;min-width:54px;text-align:right;font-variant-numeric:tabular-nums;',
      'color:var(--dsw-alias-label-secondary);font-size:12px}',
      '.ssr-icon{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;',
      'border:0;background:transparent;border-radius:7px;cursor:pointer;color:var(--dsw-alias-label-secondary)}',
      '@media (hover:hover){.ssr-icon:hover{background-color:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12));',
      'color:var(--dsw-alias-label-primary)}}',
      '.ssr-icon:disabled{opacity:.4;cursor:default}',
      '.ssr-icon:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:-2px}',
      '.ssr-note{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:16px}',
      '::highlight(dsh-session-search-all){background-color:rgba(255,199,0,.4)}',
      '::highlight(dsh-session-search-current){background-color:rgba(255,146,0,.78)}',
    ].join('')

    /**
     * The global HighlightRegistry, when the browser has the CSS Custom Highlight
     * API. Read off `window` on purpose: this file's stylesheet constant used to
     * be named `CSS`, which shadowed the global and silently disabled painting.
     * @returns {HighlightRegistry|undefined} the registry.
     */
    function highlightRegistry() {
      const registry = typeof window === 'undefined' ? undefined : window.CSS
      return registry === undefined || registry === null ? undefined : registry.highlights
    }

    /** Whether the CSS Custom Highlight API can paint ranges without touching the DOM. */
    function canHighlight() {
      const registry = highlightRegistry()
      return registry !== undefined && typeof registry.set === 'function'
        && typeof Highlight === 'function'
    }

    /** Drop every range this feature painted. */
    function clearPaint() {
      const registry = highlightRegistry()
      if (registry === undefined) return
      registry.delete(ALL_HIGHLIGHT)
      registry.delete(CURRENT_HIGHLIGHT)
    }

    /**
     * The Chat region that belongs to the column holding `node`.
     *
     * The conversation header and its Chat region are not nested in each other,
     * so the region is found by climbing to the nearest ancestor that contains
     * one: that ancestor is this column's panel, never another column's chat.
     * @param {Element|null} node - the corner's button.
     * @returns {Element|null} the region to scan.
     */
    function chatRootNear(node) {
      let parent = node === null || node === undefined ? null : node.parentElement
      while (parent !== null) {
        const found = parent.querySelector('[data-conversation-region="chat"]')
        if (found !== null) return found
        parent = parent.parentElement
      }
      return null
    }

    /**
     * The only Chat region on screen, for deciding whether Ctrl/⌘+F belongs to
     * this feature.
     * @returns {Element|null} the first region, if any.
     */
    function chatRootOf() {
      return document.querySelector('[data-conversation-region="chat"]')
    }

    /**
     * Collect one Range per occurrence of the query in the region's visible text.
     * @param {Element} root - the Chat region.
     * @param {string} query - the literal needle (case-insensitive).
     * @returns {Range[]} matches, document order, capped.
     */
    function collectRanges(root, query) {
      const ranges = []
      const needle = query.toLocaleLowerCase()
      if (needle === '') return ranges
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
      let node = walker.nextNode()
      while (node !== null) {
        const parent = node.parentElement
        const text = node.nodeValue === null ? '' : node.nodeValue
        if (parent !== null && text.length > 0 && parent.closest('[aria-hidden="true"],[hidden]') === null) {
          const hay = text.toLocaleLowerCase()
          let from = 0
          for (;;) {
            const at = hay.indexOf(needle, from)
            if (at < 0) break
            const range = document.createRange()
            range.setStart(node, at)
            range.setEnd(node, at + needle.length)
            // Screen-reader copy and clipped labels have no ink; skip them so the
            // counter matches what the eye can see.
            const rects = range.getClientRects()
            if (rects.length > 0 && (rects[0].width > 0 || rects[0].height > 0)) ranges.push(range)
            if (ranges.length >= MAX_MATCHES) return ranges
            from = at + needle.length
          }
        }
        node = walker.nextNode()
      }
      return ranges
    }

    /**
     * Bring one match to the middle of the conversation scrollport.
     * @param {Range} range - the current match.
     */
    function reveal(range) {
      const node = range.startContainer
      const element = node.nodeType === 1 ? node : node.parentElement
      if (element === null) return
      const rect = range.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) return
      const scroller = element.closest('[data-conversation-scroll]')
      if (scroller === null) {
        element.scrollIntoView({ block: 'center' })
        return
      }
      const box = scroller.getBoundingClientRect()
      scroller.scrollTop += (rect.top - box.top) - (box.height / 2) + (rect.height / 2)
    }

    /** Paint every match, with the current one in the stronger colour. */
    function paint(ranges, current) {
      if (!canHighlight()) {
        const range = ranges[current]
        if (range === undefined) return
        const selection = window.getSelection()
        if (selection === null) return
        selection.removeAllRanges()
        selection.addRange(range)
        return
      }
      if (ranges.length === 0) {
        clearPaint()
        return
      }
      const registry = highlightRegistry()
      if (registry === undefined) return
      registry.set(ALL_HIGHLIGHT, new Highlight(...ranges))
      registry.set(CURRENT_HIGHLIGHT, new Highlight(ranges[current]))
    }

    function SearchGlyph({ size }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true', focusable: 'false',
      },
        h('circle', { cx: 10.5, cy: 10.5, r: 6.5 }),
        h('path', { d: 'm15.4 15.4 4.1 4.1' }),
      )
    }

    function ChevronGlyph({ size, up }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true', focusable: 'false',
      }, h('path', { d: up ? 'm7 14 5-5 5 5' : 'm7 10 5 5 5-5' }))
    }

    function CrossGlyph({ size }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true', focusable: 'false',
      }, h('path', { d: 'm6 6 12 12' }), h('path', { d: 'm18 6-12 12' }))
    }

    /**
     * Anchor the fixed panel under the button, inside the viewport.
     * @param {HTMLElement|null} anchor - the corner button.
     * @returns {object} inline style.
     */
    function panelStyle(anchor) {
      const width = 344
      if (anchor === null || anchor === undefined || typeof anchor.getBoundingClientRect !== 'function') {
        return { top: '52px', right: '96px' }
      }
      const rect = anchor.getBoundingClientRect()
      const viewport = typeof window.innerWidth === 'number' ? window.innerWidth : 1280
      const left = Math.max(8, Math.min(rect.right - width, viewport - width - 8))
      return { top: `${Math.round(rect.bottom + 6)}px`, left: `${Math.round(left)}px` }
    }

    /**
     * Build the corner control: a search button and, while open, its portaled panel.
     * @param {Function} t - the feature's translator.
     * @returns {Function} the slot component.
     */
    function createSearch(t) {
      return function SessionSearchCorner(ownerProps) {
        const [open, setOpen] = React.useState(false)
        const [query, setQuery] = React.useState('')
        const [total, setTotal] = React.useState(0)
        const [index, setIndex] = React.useState(0)
        const buttonRef = React.useRef(null)
        const inputRef = React.useRef(null)
        const hostRef = React.useRef(null)
        // The portal target must live in state: a ref keeps the panel invisible
        // because writing it inside an effect schedules no second render.
        const [host, setHost] = React.useState(null)
        const rangesRef = React.useRef([])
        const timerRef = React.useRef(0)
        const aliveRef = React.useRef(true)

        React.useEffect(() => () => {
          aliveRef.current = false
          if (timerRef.current !== 0) window.clearTimeout(timerRef.current)
          timerRef.current = 0
          clearPaint()
          const host = hostRef.current
          if (host !== null && host.parentNode !== null) host.parentNode.removeChild(host)
          hostRef.current = null
        }, [])

        /** Rescan the conversation for the given text and land on the first hit. */
        const search = text => {
          const root = chatRootNear(buttonRef.current)
          const ranges = root === null ? [] : collectRanges(root, text)
          rangesRef.current = ranges
          setTotal(ranges.length)
          setIndex(0)
          paint(ranges, 0)
          if (ranges.length > 0) reveal(ranges[0])
        }

        /** Ask for a rescan once typing settles. */
        const schedule = text => {
          if (timerRef.current !== 0) window.clearTimeout(timerRef.current)
          timerRef.current = window.setTimeout(() => {
            timerRef.current = 0
            if (!aliveRef.current) return
            search(text)
          }, SCAN_DELAY_MS)
        }

        /** Walk to another match, wrapping at both ends. */
        const step = delta => {
          const ranges = rangesRef.current
          if (ranges.length === 0) return
          const next = (index + delta + ranges.length) % ranges.length
          setIndex(next)
          paint(ranges, next)
          reveal(ranges[next])
        }

        const clear = () => {
          setQuery('')
          setTotal(0)
          setIndex(0)
          rangesRef.current = []
          if (timerRef.current !== 0) window.clearTimeout(timerRef.current)
          timerRef.current = 0
          clearPaint()
        }

        const close = () => {
          setOpen(false)
          clear()
          const button = buttonRef.current
          if (button !== null && typeof button.focus === 'function') button.focus()
        }

        const show = () => {
          setOpen(true)
          if (query.trim() !== '') search(query)
        }

        // Ctrl/⌘+F is dispatched by the feature's own key listener.
        React.useEffect(() => {
          const onOpen = () => { setOpen(true) }
          document.addEventListener(OPEN_EVENT, onOpen)
          return () => { document.removeEventListener(OPEN_EVENT, onOpen) }
        }, [])

        // The panel is portaled: the header clips its overflow, so an in-flow
        // panel would be cut off at the first 28px of its height.
        React.useEffect(() => {
          if (!open) return undefined
          const element = document.createElement('div')
          element.setAttribute(MARK_ATTR, '')
          document.body.appendChild(element)
          hostRef.current = element
          setHost(element)
          return () => {
            if (element.parentNode !== null) element.parentNode.removeChild(element)
            if (hostRef.current === element) hostRef.current = null
            if (aliveRef.current) setHost(current => (current === element ? null : current))
          }
        }, [open])

        // Focus the field on open, and close when the pointer lands outside.
        React.useEffect(() => {
          if (!open) return undefined
          const input = inputRef.current
          if (input !== null && typeof input.focus === 'function') {
            input.focus()
            if (typeof input.select === 'function') input.select()
          }
          const onDown = event => {
            const host = hostRef.current
            const button = buttonRef.current
            const target = event.target
            if (host !== null && host.contains(target)) return
            if (button !== null && button.contains(target)) return
            setOpen(false)
            clear()
          }
          document.addEventListener('pointerdown', onDown, true)
          return () => { document.removeEventListener('pointerdown', onDown, true) }
        }, [open])

        const onKeyDown = event => {
          if (event.key === 'Enter') {
            event.preventDefault()
            step(event.shiftKey ? -1 : 1)
            return
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            close()
          }
        }

        const button = h('button', {
          type: 'button',
          ref: buttonRef,
          className: 'ssr-btn',
          'data-open': open ? 'true' : 'false',
          'data-dsh-session-search-button': 'true',
          title: t('hint.open'),
          'aria-label': t('action'),
          'aria-expanded': open ? 'true' : 'false',
          onClick: () => { if (open) close(); else show() },
        }, h(SearchGlyph, { size: 16 }))

        if (!open) return button

        const panel = h('div', {
          className: 'ssr-panel',
          role: 'dialog',
          'aria-label': t('action'),
          'data-dsh-session-search-panel': 'true',
          style: panelStyle(buttonRef.current),
        },
          h('div', { className: 'ssr-row' },
            h('input', {
              ref: inputRef,
              className: 'ssr-input',
              type: 'text',
              value: query,
              placeholder: t('placeholder'),
              'aria-label': t('placeholder'),
              spellCheck: false,
              onKeyDown,
              onChange: event => {
                const text = event.currentTarget.value
                setQuery(text)
                if (text === '') {
                  clear()
                  return
                }
                schedule(text)
              },
            }),
            h('span', { className: 'ssr-count' }, total === 0 ? '0/0' : `${index + 1}/${total}`)),
          h('div', { className: 'ssr-row' },
            h('button', {
              type: 'button', className: 'ssr-icon', title: t('prev'), 'aria-label': t('prev'),
              disabled: total === 0, onClick: () => { step(-1) },
            }, h(ChevronGlyph, { size: 16, up: true })),
            h('button', {
              type: 'button', className: 'ssr-icon', title: t('next'), 'aria-label': t('next'),
              disabled: total === 0, onClick: () => { step(1) },
            }, h(ChevronGlyph, { size: 16, up: false })),
            h('span', { className: 'ssr-note', style: { flex: 1, minWidth: 0 } },
              total === 0 && query.trim() !== '' ? t('none') : t('idle')),
            h('button', {
              type: 'button', className: 'ssr-icon', title: t('close'), 'aria-label': t('close'),
              onClick: close,
            }, h(CrossGlyph, { size: 15 }))))

        return h(React.Fragment, null, button,
          host === null ? null : ReactDOM.createPortal(panel, host))
      }
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-search: dictionaries')
        const t = ctx.locale.bind(NS)

        ctx.effect(() => {
          const style = document.createElement('style')
          style.setAttribute(MARK_ATTR, '')
          style.textContent = STYLES
          document.head.appendChild(style)
          return () => style.remove()
        }, 'session-search: styles')

        ctx.effect(() => {
          const onKeyDown = event => {
            if (event.defaultPrevented) return
            if (event.key !== 'f' && event.key !== 'F') return
            if (!(event.ctrlKey || event.metaKey) || event.altKey) return
            if (chatRootOf() === null) return
            event.preventDefault()
            document.dispatchEvent(new CustomEvent(OPEN_EVENT))
          }
          document.addEventListener('keydown', onKeyDown)
          return () => {
            document.removeEventListener('keydown', onKeyDown)
            clearPaint()
          }
        }, 'session-search: shortcut')

        ctx.slots.inject(SLOT, () => ctx.slots.register({
          name: SLOT,
          id: 'session-search',
          order: 50,
        }, createSearch(t)))
      },
    }
  },
})
