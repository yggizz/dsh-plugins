/**
 * Client half of `archive-filter-toggle` (feature 7 of dsh-plugin-suite).
 *
 * One button in the sidebar's Workspace section header flips the Session list
 * between «hide archived» and «archived only». Two states, not three: the
 * «all conversations» middle state is reachable from the built-in menu and is
 * never needed as a step of this toggle, so a click always lands on one of the
 * two extremes.
 *
 * Why a click on the shipped menu instead of a service call: the archive filter
 * lives inside the Workspace package's private viewing store
 * (`persist: 'dsh.workspace.view.v5'`, field `archivedFilter`). The client store
 * writes localStorage but never reads it back within a page, and the public
 * `uiWorkspace` service exposes no way to set the filter. The menu's three
 * `button[role="menuitem"]` rows are therefore the only writable entry point.
 *
 * Placement: the section header is
 *   [data-sidebar-workspace-header] > [label] [searchSlot] [headerActions]
 * where `.headerActions` is capped at 60px for exactly two 28px buttons and the
 * free space between the label and the search control comes from
 * `.searchSlot { margin-left: auto }`. The button therefore goes in its own
 * flex:1 wrapper inserted immediately before that search slot: the wrapper eats
 * the free space and right-aligns its content, which lands the button exactly in
 * that gap without touching any shipped class or inline style.
 *
 * The rail (collapsed) sidebar renders no search input in the header, so the
 * wrapper is only inserted while the input exists — the collapsed 36px column
 * keeps its two icon controls untouched.
 *
 * Silent by design (owner's call): a toggle draws no screen notice at all. The
 * state is visible in the glyph (struck-through box = hiding, ticked box =
 * archived only) and in the button's tooltip; failures only reach the console.
 */
window.__ModuleLoader__.load({
  id: '@local/archive-filter-toggle',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** The shipped viewing store's persistence key and the field this feature drives. */
    const STORE_KEY = 'dsh.workspace.view.v5'
    const FILTER_FIELD = 'archivedFilter'
    /** The two states this toggle lands on. `show` exists but is not a stop of the cycle. */
    const HIDDEN = 'default'
    const ONLY = 'only'
    /** The header marker the shipped UI owns; a data attribute, not a hashed class. */
    const HEADER_SELECTOR = '[data-sidebar-workspace-header]'
    /** This feature's own marker on the wrapper it inserts. */
    const MARK_ATTR = 'data-psx-archive-toggle'

    /**
     * The menu anchor's accessible label, one per locale the Workspace package
     * ships. The `… / lang / ja / es / fr / de / ru / pt` order matches its
     * dictionaries.
     */
    const MENU_LABELS = [
      '视图选项', 'View options', '表示オプション', 'Ver opciones',
      'Afficher les options', 'Optionen anzeigen', 'Посмотреть варианты', 'Ver opções',
    ]
    /** The «archived only» row's label, same locale set. */
    const ITEM_ONLY = [
      '仅显示已归档', 'Archived only', 'アーカイブのみ', 'Sólo archivado',
      'Archivé uniquement', 'Nur archiviert', 'Только в архиве', 'Somente arquivado',
    ]
    /** The «hide archived» row's label, same locale set. */
    const ITEM_HIDE = [
      '隐藏已归档', 'Hide archived', 'アーカイブを非表示', 'Ocultar archivado',
      'Masquer les archives', 'Archiviert ausblenden', 'Скрыть в архиве', 'Ocultar arquivado',
    ]

    /** Copy for the two UI languages this suite speaks; anything else reads English. */
    const COPY = {
      zh: {
        hide: '隐藏已归档',
        only: '仅显示已归档',
        hint: '切换归档筛选',
      },
      en: {
        hide: 'Hide archived',
        only: 'Archived only',
        hint: 'Toggle the archived filter',
      },
    }

    /** Two 16px glyphs: an archive box struck through, and the same box ticked. */
    const SVG_HIDE = '<svg viewBox="0 0 16 16" aria-hidden="true"><g fill="none" stroke="currentColor"'
      + ' stroke-width="1.4" stroke-linejoin="round"><rect x="2.2" y="3.4" width="11.6" height="3" rx="1"></rect>'
      + '<path d="M3.4 6.4v5.6a1 1 0 0 0 1 1h7.2a1 1 0 0 0 1-1V6.4"></path></g>'
      + '<path d="M3 13.2 13.2 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></path></svg>'
    const SVG_ONLY = '<svg viewBox="0 0 16 16" aria-hidden="true"><g fill="none" stroke="currentColor"'
      + ' stroke-width="1.4" stroke-linejoin="round"><rect x="2.2" y="3.4" width="11.6" height="3" rx="1"></rect>'
      + '<path d="M3.4 6.4v5.6a1 1 0 0 0 1 1h7.2a1 1 0 0 0 1-1V6.4"></path></g>'
      + '<path d="M5.7 10.9 7.5 12.7 10.9 9.1" fill="none" stroke="currentColor" stroke-width="1.6"'
      + ' stroke-linecap="round" stroke-linejoin="round"></path></svg>'

    const CSS = [
      '.psx-archive-slot{flex:1;min-width:0;display:flex;justify-content:flex-end;align-items:center;overflow:hidden;}',
      '.psx-archive-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;',
      'padding:0;border:0;border-radius:6px;background:transparent;flex:none;cursor:pointer;',
      'color:var(--dsw-alias-label-tertiary,#8b8b8b);transition:background .12s ease,color .12s ease;}',
      '.psx-archive-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14));',
      'color:var(--dsw-alias-label-primary,#222);}',
      '.psx-archive-btn:focus-visible{outline:1px solid var(--dsw-alias-label-secondary,#666);outline-offset:1px;}',
      '.psx-archive-btn[data-state="only"]{color:var(--dsw-alias-brand-primary,#3f6fd8);}',
      '.psx-archive-btn svg{width:16px;height:16px;display:block;}',
      '[data-sidebar-workspace-header]:has(input[type="text"][tabindex="0"]) .psx-archive-slot{display:none;}',
    ].join('')

    /** Copy for one locale id; every non-Chinese language reads English. */
    function copyFor(localeId) {
      const id = String(localeId || '')
      return id === 'zh' || id.startsWith('zh-') ? COPY.zh : COPY.en
    }

    /** Whether one accessible label is one of the given shipped strings. */
    function labelMatch(text, labels) {
      const value = String(text || '').replace(/\s+/g, ' ').trim()
      return value !== '' && labels.includes(value)
    }

    /** The first button under `root` whose accessible label is in `labels`. */
    function findButton(root, labels) {
      for (const button of root.querySelectorAll('button')) {
        if (labelMatch(button.getAttribute('aria-label'), labels)) return button
      }
      return null
    }

    /** The persisted filter, or undefined when the document is missing or unreadable. */
    function readFilter() {
      try {
        const raw = window.localStorage.getItem(STORE_KEY)
        if (raw === null) return HIDDEN
        const parsed = JSON.parse(raw)
        const value = parsed === null || typeof parsed !== 'object' ? undefined : parsed[FILTER_FIELD]
        if (value === HIDDEN || value === 'show' || value === ONLY) return value
        return HIDDEN
      } catch (_error) {
        return undefined
      }
    }

    /**
     * The state one click lands on.
     * @param current - the filter read before the click.
     * @returns `only` from the hidden and the all-conversations views, `default` from archived-only.
     */
    function targetFor(current) {
      if (current === HIDDEN) return ONLY
      if (current === ONLY) return HIDDEN
      /* `show` (or an unreadable document) counts as «archives visible»: narrow to archived only. */
      return ONLY
    }

    /**
     * The row of an open menu that selects one filter.
     *
     * By label first, because that is what the user sees; then by position, so a
     * reworded locale still works: the shipped menu ends with
     * `…, hide-archived, show-archived, only-archived`.
     * @param menu - the open `[role="menu"]` element.
     * @param target - the filter to select.
     * @returns the row's button, or null when the menu is not the one expected.
     */
    function pickItem(menu, target) {
      const byLabel = findButton(menu, target === ONLY ? ITEM_ONLY : ITEM_HIDE)
      if (byLabel !== null) return byLabel
      const items = [...menu.querySelectorAll('button[role="menuitem"]')]
      if (items.length < 3) return null
      return target === ONLY ? items[items.length - 1] : items[items.length - 3]
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const locale = ctx.get !== undefined ? ctx.get('locale') : undefined
        const copy = () => {
          if (locale === undefined || typeof locale.getLocale !== 'function') return COPY.zh
          const snapshot = locale.getLocale()
          return copyFor(snapshot !== null && typeof snapshot === 'object' ? snapshot.id : 'zh-CN')
        }
        const warn = (message) => console.warn('[archive-filter-toggle]', message)

        /** This feature's DOM and timers, all released by one disposer. */
        const state = { slot: null, button: null, settle: 0, timers: new Set(), disposed: false }

        /** Repaint the button for the filter currently stored. */
        function refresh() {
          const button = state.button
          if (button === null || !button.isConnected) return
          const current = readFilter()
          const archivedOnly = current === ONLY
          const text = copy()
          const label = archivedOnly ? text.only : text.hide
          button.dataset.state = archivedOnly ? 'only' : 'hide'
          button.setAttribute('aria-label', label)
          button.setAttribute('title', current === undefined ? text.hint : `${text.hint} · ${label}`)
          /* innerHTML with two fixed literals: no page content ever reaches it. */
          const markup = archivedOnly ? SVG_ONLY : SVG_HIDE
          if (button.dataset.svg !== (archivedOnly ? 'only' : 'hide')) {
            button.dataset.svg = archivedOnly ? 'only' : 'hide'
            button.innerHTML = markup
          }
        }

        /**
         * Open the shipped view-options menu and click one filter row.
         * @param target - the filter to select.
         */
        function switchTo(target) {
          const header = document.querySelector(HEADER_SELECTOR)
          if (header === null) {
            warn('workspace header not found; nothing to drive')
            return
          }
          const anchor = findButton(header, MENU_LABELS)
          if (anchor === null) {
            warn('view options button not found')
            return
          }
          const before = document.activeElement
          anchor.click()
          /* The popover portals and mounts a frame or two later; poll briefly instead of guessing a delay. */
          let tries = 0
          const timer = window.setInterval(() => {
            tries += 1
            const menu = document.querySelector('[role="menu"]')
            const item = menu === null ? null : pickItem(menu, target)
            if (item !== null) {
              window.clearInterval(timer)
              state.timers.delete(timer)
              item.click()
              if (before !== null && typeof before.focus === 'function' && document.activeElement !== before) {
                before.focus()
              }
              window.setTimeout(() => {
                refresh()
                const now = readFilter()
                if (now !== undefined && now !== target) {
                  warn(`filter still ${now} after the menu click`)
                }
              }, 160)
              return
            }
            if (tries > 20) {
              window.clearInterval(timer)
              state.timers.delete(timer)
              warn('archive filter rows never appeared in the menu')
            }
          }, 30)
          state.timers.add(timer)
        }

        /** One click: read the current filter, pick the other end, drive the menu. */
        function onClick(event) {
          event.preventDefault()
          event.stopPropagation()
          switchTo(targetFor(readFilter()))
        }

        /**
         * The header child that holds the inline search control — present only
         * while the sidebar is wide, which is the only place this button belongs.
         * @param header - the section header.
         * @returns the search slot, or null in the collapsed rail.
         */
        function searchSlotOf(header) {
          const input = header.querySelector('input[type="text"]')
          if (input === null) return null
          let node = input
          while (node.parentElement !== null && node.parentElement !== header) node = node.parentElement
          return node.parentElement === header ? node : null
        }

        /** Insert the button when the header is drawn; a no-op once it is there. */
        function ensure() {
          if (state.disposed) return
          /* Every header, not just the first: the shell may leave a stale one in the
             DOM while the live list re-mounts, and the first match is not always the
             one that draws the search control. */
          const headers = document.querySelectorAll(HEADER_SELECTOR)
          for (const header of headers) {
            const present = header.querySelector(`[${MARK_ATTR}]`)
            if (present !== null) {
              if (state.button === null || !state.button.isConnected) {
                const button = present.querySelector('button')
                if (button !== null) {
                  button.addEventListener('click', onClick)
                  state.slot = present
                  state.button = button
                }
              }
              refresh()
              continue
            }
            const anchor = searchSlotOf(header)
            if (anchor === null) continue
            const slot = document.createElement('div')
            slot.className = 'psx-archive-slot'
            slot.setAttribute(MARK_ATTR, '')
            const button = document.createElement('button')
            button.type = 'button'
            button.className = 'psx-archive-btn'
            button.addEventListener('click', onClick)
            slot.appendChild(button)
            header.insertBefore(slot, anchor)
            state.slot = slot
            state.button = button
            refresh()
          }
        }

        /** Collapse one burst of shell re-renders into one reconciliation pass. */
        function schedule() {
          if (state.settle !== 0 || state.disposed) return
          state.settle = window.setTimeout(() => {
            state.settle = 0
            ensure()
          }, 180)
        }

        ctx.effect(() => {
          const style = document.createElement('style')
          style.setAttribute('data-dsh-archive-filter-toggle', '')
          style.textContent = CSS
          document.head.appendChild(style)
          const observer = new MutationObserver(schedule)
          observer.observe(document.body, { childList: true, subtree: true })
          window.addEventListener('storage', refresh)
          ensure()
          return () => {
            state.disposed = true
            observer.disconnect()
            window.removeEventListener('storage', refresh)
            if (state.settle !== 0) window.clearTimeout(state.settle)
            state.settle = 0
            for (const timer of state.timers) {
              window.clearInterval(timer)
              window.clearTimeout(timer)
            }
            state.timers.clear()
            if (state.button !== null) state.button.removeEventListener('click', onClick)
            /* Remove every wrapper this feature inserted, including one the shell
               detached while re-rendering: the mark is the only reliable handle. */
            for (const node of [...document.querySelectorAll(`[${MARK_ATTR}]`)]) node.remove()
            state.slot = null
            state.button = null
            style.remove()
            delete window.__dshArchiveFilterToggle
          }
        }, 'archive-filter-toggle: header button')

        window.__dshArchiveFilterToggle = {
          current: readFilter,
          toggle: () => switchTo(targetFor(readFilter())),
          refresh,
        }
      },
    }
  },
})
