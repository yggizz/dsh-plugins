/**
 * Client half of `@yggizz/dsh-sidebar-pins`.
 *
 * The shipped sidebar keeps its unpinned-panel list in memory only
 * (`createPanelPins` in `@deepseek-ai/dsh-client-ui-sidebar`), so a reload or
 * restart puts every launcher back into the left sidebar. This module records
 * the launchers you unpin, keeps the list in `localStorage` plus a cookie
 * (cookies ignore the port, which changes between Desktop launches), and
 * replays the same unpin action early on every start.
 */
window.__ModuleLoader__.load({
  id: '@yggizz/dsh-sidebar-pins',
  factory() {
    /** Same JSON list in both places; the cookie survives an origin port change. */
    const STORE_KEY = 'dsh.sidebar.pins.v1';
    const COOKIE_KEY = 'dsh_sidebar_pins_v1';
    const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
    /** Do not retry one launcher more often than this after a replay click. */
    const RETRY_MS = 2500;
    /** Collapse one burst of DOM mutations into one replay pass. */
    const SETTLE_MS = 250;

    const desired = new Set(readNames());
    const lastClick = new Map();
    let observer;
    let settleTimer;
    let disposers = [];

    function isName(value) {
      return typeof value === 'string' && value.trim().length > 0;
    }

    function parseNames(raw) {
      if (!isName(raw)) return [];
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter(isName) : [];
      } catch (_error) {
        return [];
      }
    }

    function cookieValue(key) {
      const parts = String(document.cookie || '').split(';');
      for (const part of parts) {
        const index = part.indexOf('=');
        if (index < 0) continue;
        if (part.slice(0, index).trim() !== key) continue;
        try {
          return decodeURIComponent(part.slice(index + 1).trim());
        } catch (_error) {
          return '';
        }
      }
      return '';
    }

    function readNames() {
      let stored = [];
      try {
        stored = parseNames(window.localStorage.getItem(STORE_KEY));
      } catch (_error) {
        stored = [];
      }
      return stored.length > 0 ? stored : parseNames(cookieValue(COOKIE_KEY));
    }

    function persist() {
      const raw = JSON.stringify([...desired]);
      try {
        window.localStorage.setItem(STORE_KEY, raw);
      } catch (_error) {
        /* browser storage unavailable */
      }
      try {
        document.cookie = COOKIE_KEY + '=' + encodeURIComponent(raw)
          + '; path=/; max-age=' + COOKIE_MAX_AGE + '; SameSite=Lax';
      } catch (_error) {
        /* cookies unavailable on this origin */
      }
    }

    function sidebarNav() {
      return document.querySelector('[data-sidebar-scrollport] nav');
    }

    /** The two-button wrapper of one panel row: the launcher plus its unpin control. */
    function rowPair(button) {
      let node = button.parentElement;
      while (node !== null && node.tagName !== 'NAV') {
        const buttons = [...node.querySelectorAll('button')];
        if (buttons.length === 2) return buttons;
        node = node.parentElement;
      }
      return null;
    }

    function isRowLabel(button) {
      const label = (button.getAttribute('aria-label') || '').trim();
      return label.length > 0 && (button.textContent || '').trim() === label;
    }

    /** Panel rows currently drawn in the expanded sidebar. */
    function panelRows(nav) {
      const rows = [];
      for (const button of nav.querySelectorAll('button[aria-label]')) {
        if (button.getAttribute('aria-haspopup') !== null) continue;
        if (!isRowLabel(button)) continue;
        const pair = rowPair(button);
        if (pair === null) continue;
        const unpin = pair[0] === button ? pair[1] : pair[0];
        if (unpin === button || isRowLabel(unpin)) continue;
        rows.push({ name: (button.getAttribute('aria-label') || '').trim(), unpin });
      }
      return rows;
    }

    /** The clicked control is an unpin button: report the launcher label it belongs to. */
    function unpinTarget(button) {
      if (isRowLabel(button)) return null;
      const pair = rowPair(button);
      if (pair === null) return null;
      const other = pair[0] === button ? pair[1] : pair[0];
      if (!isRowLabel(other)) return null;
      return (other.getAttribute('aria-label') || '').trim();
    }

    /** The clicked control is the More menu's pin action: report its row label. */
    function pinTarget(button) {
      if ((button.getAttribute('role') || '') !== 'menuitem') return null;
      const label = (button.getAttribute('aria-label') || '').trim();
      /* The launcher row inside the menu carries the entry text; the pin action is icon-only. */
      if (label.length === 0 || (button.textContent || '').trim().length !== 0) return null;
      const row = button.parentElement;
      if (row === null) return null;
      if (row.querySelectorAll('button').length !== 2) return null;
      const name = (row.textContent || '').trim();
      return name.length > 0 ? name : null;
    }

    function addName(name) {
      if (!isName(name) || desired.has(name)) return;
      desired.add(name);
      persist();
      apply();
    }

    function removeName(name) {
      if (!isName(name) || !desired.has(name)) return;
      desired.delete(name);
      persist();
    }

    function blurAfterReplay(before) {
      const active = document.activeElement;
      if (active === before || active === null || typeof active.blur !== 'function') return;
      if (active.tagName === 'BODY') return;
      /* The shell focuses the More launcher after an unpin, which would draw a ring nobody asked for. */
      active.blur();
    }

    function apply() {
      if (desired.size === 0) return;
      const now = Date.now();
      for (const name of [...desired]) {
        if (now - (lastClick.get(name) || 0) < RETRY_MS) continue;
        const nav = sidebarNav();
        if (nav === null) return;
        const row = panelRows(nav).find(candidate => candidate.name === name);
        if (row === undefined) continue;
        lastClick.set(name, Date.now());
        const before = document.activeElement;
        row.unpin.click();
        blurAfterReplay(before);
      }
    }

    function scheduleApply() {
      if (settleTimer !== undefined) return;
      settleTimer = window.setTimeout(() => {
        settleTimer = undefined;
        apply();
      }, SETTLE_MS);
    }

    function onClick(event) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest('button');
      if (button === null) return;
      const unpin = unpinTarget(button);
      if (unpin !== null) {
        addName(unpin);
        return;
      }
      const pin = pinTarget(button);
      if (pin !== null) removeName(pin);
    }

    return {
      inject: [],
      apply(ctx) {
        const listen = (element, type, handler, capture) => {
          element.addEventListener(type, handler, capture);
          const off = () => element.removeEventListener(type, handler, capture);
          disposers.push(off);
        };

        listen(document, 'click', onClick, true);
        observer = new MutationObserver(scheduleApply);
        observer.observe(document.body, { childList: true, subtree: true });
        disposers.push(() => observer.disconnect());

        const startTimers = [0, 250, 1000, 3000].map(delay => window.setTimeout(apply, delay));
        disposers.push(() => {
          for (const timer of startTimers) window.clearTimeout(timer);
        });

        window.__dshSidebarPins = {
          list: () => [...desired],
          add: name => addName(name),
          remove: name => removeName(name),
          apply,
        };

        ctx.effect(() => () => {
          for (const off of disposers) off();
          disposers = [];
          window.clearTimeout(settleTimer);
          settleTimer = undefined;
          delete window.__dshSidebarPins;
        });
      },
    };
  },
});
