/**
 * Client half of `@yggizz/dsh-theme-toggle`.
 *
 * Two placements, picked by the environment the page runs in:
 *
 *  - Windows desktop draws a native caption band above the frame
 *    (`html[data-windows-titlebar]`, written by the Electron preload). There the
 *    button rides that band through the frame-wide `shell.overlay` seat.
 *  - Everywhere else — the browser Web UI, and macOS desktop, which has no
 *    caption band — the same button lives in the sidebar foot
 *    (`sidebar.footer.action`): a full row while the column is wide, a centered
 *    icon once it collapses to the 56px rail, a drawer entry in drawer mode. Its
 *    width and its presence follow the column instead of the window.
 *
 * The caption placement follows the sidebar instead of a frozen coordinate.
 * The caption's own left cluster moves when the sidebar opens and collapses:
 * the preload's Application/Edit menubar is anchored at
 * `--dsh-windows-menu-start` (48px expanded, 84px collapsed, because the
 * collapsed rail parks New Session in the caption at 48px), and every caption
 * plugin measures itself against that menubar. A hard-coded `left` therefore
 * lands correctly in one state and jams against the neighbours in the other, so
 * this anchor measures the live menubar box and the neighbouring caption group
 * (`[data-dsh-refresh-restart]`) and re-places itself on the same events the
 * shell animates on: the collapse/expand track transition, a window resize, a
 * click or keypress that changes the caption, and a locale change that widens
 * the menu labels.
 *
 * Both registrations are live at once and CSS keeps exactly one of them drawn
 * (`html[data-windows-titlebar]` vs `html:not([data-windows-titlebar])`), so a
 * marker that lands after this module loads cannot leave both on screen.
 */
window.__ModuleLoader__.load({
  id: '@yggizz/dsh-theme-toggle',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const COPY = {
      zh: { toLight: '切换到浅色', toDark: '切换到深色' },
      en: { toLight: 'Switch to light', toDark: 'Switch to dark' },
    };

    function copyFor(localeId) {
      const id = String(localeId || '');
      return id === 'zh' || id.startsWith('zh-') ? COPY.zh : COPY.en;
    }

    function resolvedScheme(snapshot) {
      const active = snapshot && snapshot.active;
      return active && active.colorScheme === 'dark' ? 'dark' : 'light';
    }

    function SunIcon() {
      return h('svg', { viewBox: '0 0 24 24', width: 16, height: 16, 'aria-hidden': 'true' },
        h('circle', { cx: 12, cy: 12, r: 3.25, fill: 'currentColor' }),
        h('g', { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' },
          h('path', { d: 'M12 3.1v2.2M12 18.7v2.2M3.1 12h2.2M18.7 12h2.2M5.7 5.7l1.55 1.55M16.75 16.75l1.55 1.55M18.3 5.7l-1.55 1.55M7.25 16.75 5.7 18.3' })));
    }

    function MoonIcon() {
      return h('svg', { viewBox: '0 0 24 24', width: 16, height: 16, 'aria-hidden': 'true' },
        h('path', {
          fill: 'currentColor',
          d: 'M14.7 3.2a8.15 8.15 0 1 0 6.05 12.35A6.85 6.85 0 0 1 14.7 3.2Z',
        }));
    }

    /** Host faces captured in apply(); components read them at render time. */
    const services = { theme: undefined, locale: undefined, ctx: undefined };

    /**
     * Shared theme + locale state for every placement, so both buttons show the
     * same glyph and the same label and follow the same events.
     * @returns the active scheme, the id a click switches to, and its label.
     */
    function useThemeState() {
      const [snapshot, setSnapshot] = React.useState(() => (
        services.theme && typeof services.theme.getTheme === 'function' ? services.theme.getTheme() : null
      ));
      const [localeId, setLocaleId] = React.useState(() => {
        const locale = services.locale;
        if (!locale || typeof locale.getLocale !== 'function') return 'zh-CN';
        const current = locale.getLocale();
        return current && current.id ? current.id : 'zh-CN';
      });

      React.useEffect(() => {
        const ctx = services.ctx;
        if (!ctx || typeof ctx.on !== 'function') return undefined;
        return ctx.on('theme/change', (next) => setSnapshot(next));
      }, []);

      React.useEffect(() => {
        const ctx = services.ctx;
        if (!ctx || typeof ctx.on !== 'function') return undefined;
        return ctx.on('locale/change', (next) => {
          setLocaleId(next && next.id ? next.id : 'zh-CN');
        });
      }, []);

      const scheme = resolvedScheme(snapshot);
      const nextId = scheme === 'dark' ? 'light' : 'dark';
      const text = copyFor(localeId);
      return { scheme, nextId, label: nextId === 'dark' ? text.toDark : text.toLight };
    }

    function toggleTheme(nextId) {
      const theme = services.theme;
      if (theme && typeof theme.setTheme === 'function') theme.setTheme(nextId);
    }

    /* ---------------------------------------------------------------- *
     * Caption placement (Windows only; CSS hides it elsewhere)
     * ---------------------------------------------------------------- */

    /** Space kept between the caption cluster and this button. */
    const CAPTION_GAP = 8;
    /** The preload's own fixed menubar host: Application / Edit. */
    const MENU_SELECTOR = '[data-windows-menu]';
    /** The neighbouring caption plugin that parks its controls after the menu. */
    const NEIGHBOUR_SELECTOR = '[data-dsh-refresh-restart]';
    /** Button box, needed to keep the control inside the caption. */
    const CONTROL_WIDTH = 28;
    /**
     * Re-measure points after any trigger: the sidebar track animates for 150ms
     * and a neighbouring caption plugin settles on its own rAF, so one
     * measurement right on the event would read a half-finished layout.
     */
    const SETTLE_DELAYS = [0, 60, 140, 260, 420, 640];

    /**
     * Left edge of the caption button, in viewport pixels.
     * @returns the measured x, or null while the caption menubar is not laid out
     * (no caption, or the first paint before the preload mounts it).
     */
    function measureCaptionLeft() {
      const menu = document.querySelector(MENU_SELECTOR);
      if (menu === null || typeof menu.getBoundingClientRect !== 'function') return null;
      const menuRect = menu.getBoundingClientRect();
      if (!(menuRect.width > 0)) return null;
      let left = menuRect.right + CAPTION_GAP;
      // A neighbouring caption group that already sits right of the menubar
      // keeps its place: this button queues behind it instead of on top of it.
      const neighbour = document.querySelector(NEIGHBOUR_SELECTOR);
      if (neighbour !== null && typeof neighbour.getBoundingClientRect === 'function') {
        const rect = neighbour.getBoundingClientRect();
        if (rect.width > 0 && rect.right > menuRect.right) {
          left = Math.max(left, rect.right + CAPTION_GAP);
        }
      }
      const viewport = typeof window.innerWidth === 'number' ? window.innerWidth : 0;
      if (viewport > 0 && left + CONTROL_WIDTH > viewport) {
        left = viewport - CONTROL_WIDTH - CAPTION_GAP;
      }
      return Math.round(left);
    }

    /**
     * Follow the caption cluster as the sidebar opens and collapses.
     * @returns the measured left edge, or null before the caption exists.
     */
    function useCaptionLeft() {
      const [left, setLeft] = React.useState(() => measureCaptionLeft());

      React.useEffect(() => {
        let alive = true;
        let timers = [];
        let observer = null;
        let mountObserver = null;
        let resizeObserver = null;
        let watchedMenu = null;

        const apply = () => {
          if (!alive) return;
          const next = measureCaptionLeft();
          setLeft((previous) => (previous === next ? previous : next));
        };

        const watchMenu = () => {
          if (typeof ResizeObserver !== 'function') return;
          const menu = document.querySelector(MENU_SELECTOR);
          if (menu === null || menu === watchedMenu) return;
          if (resizeObserver !== null) resizeObserver.disconnect();
          watchedMenu = menu;
          resizeObserver = new ResizeObserver(apply);
          resizeObserver.observe(menu);
        };

        const schedule = () => {
          for (const timer of timers) window.clearTimeout(timer);
          timers = SETTLE_DELAYS.map((delay) => window.setTimeout(() => {
            watchMenu();
            apply();
          }, delay));
        };

        apply();
        watchMenu();
        schedule();
        window.addEventListener('resize', schedule);
        document.addEventListener('transitionend', schedule, true);
        document.addEventListener('click', schedule, true);
        window.addEventListener('keydown', schedule, true);
        if (typeof MutationObserver === 'function') {
          // The cluster's own x comes from `--dsh-windows-menu-start`, which the
          // sidebar rebinds off `data-sidebar-collapsed`; that flip is the one
          // attribute worth watching. The menubar's width (a locale change) is
          // covered by the ResizeObserver above, so no attribute spam from the
          // frame's per-pointer style rewrites.
          observer = new MutationObserver(schedule);
          observer.observe(document.body, {
            attributes: true,
            attributeFilter: ['data-sidebar-collapsed'],
            subtree: true,
          });
          // The preload appends the menubar to document.body once the shell
          // overlay exists, which can be after this seat's first render: the
          // seat renders nothing until the cluster is measurable, so it has to
          // notice that mount instead of waiting for a user event. Only a
          // changed menubar identity is worth a re-measure; the body sees plenty
          // of unrelated child churn (toasts, overlays).
          mountObserver = new MutationObserver(() => {
            if (document.querySelector(MENU_SELECTOR) !== watchedMenu) schedule();
          });
          mountObserver.observe(document.body, { childList: true });
        }
        return () => {
          alive = false;
          for (const timer of timers) window.clearTimeout(timer);
          if (observer !== null) observer.disconnect();
          if (mountObserver !== null) mountObserver.disconnect();
          if (resizeObserver !== null) resizeObserver.disconnect();
          window.removeEventListener('resize', schedule);
          document.removeEventListener('transitionend', schedule, true);
          document.removeEventListener('click', schedule, true);
          window.removeEventListener('keydown', schedule, true);
        };
      }, []);

      return left;
    }

    /**
     * Caption-band button: the Windows desktop placement. It is the only one that
     * subtracts itself from the window drag region, because only the caption band
     * is a drag surface.
     * @returns the 28px icon button.
     */
    function CaptionToggle() {
      const { scheme, nextId, label } = useThemeState();
      return h('button', {
        type: 'button',
        className: 'dsh-theme-toggle dsh-theme-toggle-caption',
        'aria-label': label,
        title: label,
        onClick() { toggleTheme(nextId); },
      }, scheme === 'dark' ? h(SunIcon) : h(MoonIcon));
    }

    /** Caption seat: places the button after the live menubar, not at a constant x. */
    function CaptionAnchor() {
      const left = useCaptionLeft();
      if (left === null) return null;
      return h('div', {
        className: 'dsh-theme-toggle-anchor',
        'data-dsh-theme-toggle-anchor': '',
        style: { left: left + 'px' },
      }, h(CaptionToggle));
    }

    /**
     * Sidebar-foot button: the browser and macOS placement. The owner passes the
     * column's `wide` state, so the row and the rail icon are the same control in
     * the two shapes the sidebar itself uses.
     * @param props - `wide` from `sidebar.footer.action`.
     * @returns the row button, or the rail icon button.
     */
    function SidebarFootToggle(props) {
      const wide = Boolean(props && props.wide);
      const { scheme, nextId, label } = useThemeState();
      const glyph = h('span', { className: 'dsh-theme-toggle-glyph', 'aria-hidden': 'true' },
        scheme === 'dark' ? h(SunIcon) : h(MoonIcon));
      const buttonProps = {
        type: 'button',
        className: wide ? 'dsh-theme-toggle dsh-theme-toggle-row' : 'dsh-theme-toggle dsh-theme-toggle-rail',
        'aria-label': label,
        title: label,
        onClick() { toggleTheme(nextId); },
      };
      if (!wide) return h('button', buttonProps, glyph);
      return h('button', buttonProps, glyph,
        h('span', { className: 'dsh-theme-toggle-label' }, label));
    }

    const CSS = [
      // Windows caption band (see module doc): the band is a window-drag region
      // (AppFrame paints it as .frame::before with -webkit-app-region: drag),
      // height = the titlebar token. Electron hit-tests app regions
      // geometrically, so a control drawn there swallows every click as a window
      // drag unless it subtracts itself with no-drag, exactly as the shipped
      // caption menubar and sidebar toggle do. No left is stated here: the
      // component measures the live caption cluster on every sidebar change.
      '.dsh-theme-toggle-anchor{',
      'position:fixed;z-index:40;',
      'top:calc((var(--dsh-windows-titlebar-height, 40px) - 28px) / 2);',
      'display:flex;align-items:center;height:28px;pointer-events:none;',
      '-webkit-app-region:no-drag;',
      '}',
      '.dsh-theme-toggle{',
      'pointer-events:auto;display:inline-flex;align-items:center;justify-content:center;',
      'width:28px;height:28px;padding:0;border:0;border-radius:6px;',
      'background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;',
      'font:inherit;-webkit-app-region:no-drag;',
      '}',
      '.dsh-theme-toggle:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}',
      '.dsh-theme-toggle:focus-visible{outline:1px solid var(--dsw-alias-label-secondary);outline-offset:1px;}',
      'html[data-input-modality="pointer"] .dsh-theme-toggle:focus-visible{outline-color:transparent;}',
      // Sidebar foot: the row matches the column's own navigation rows (32px,
      // 12px rounding, hover fill); the rail keeps the 36px icon square the
      // collapsed column gives every control there. No viewport coordinate is
      // involved in either, so a dragged, collapsed, or drawer sidebar simply
      // takes the button with it.
      '.dsh-theme-toggle-row{',
      'width:100%;height:32px;justify-content:flex-start;gap:6px;padding:0 9px;',
      'border-radius:var(--dsw-radius-md);font-size:14px;line-height:22px;',
      'color:var(--dsw-alias-label-primary);',
      '}',
      '.dsh-theme-toggle-row:hover{background:var(--dsw-alias-interactive-bg-hover);}',
      '.dsh-theme-toggle-glyph{display:inline-flex;align-items:center;justify-content:center;flex:none;}',
      '.dsh-theme-toggle-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.dsh-theme-toggle-rail{',
      'width:36px;height:36px;border-radius:var(--dsw-radius-md);',
      'color:var(--dsw-alias-label-primary);',
      '}',
      // Exactly one placement is drawn. The caption button needs the band the
      // preload marks; the sidebar row needs a column, and the Windows column has
      // none once it collapses (its foot is hidden outright).
      'html[data-windows-titlebar] .dsh-theme-toggle.dsh-theme-toggle-row,',
      'html[data-windows-titlebar] .dsh-theme-toggle.dsh-theme-toggle-rail{display:none;}',
      'html:not([data-windows-titlebar]) .dsh-theme-toggle-anchor{display:none;}',
    ].join('');

    return {
      inject: ['slots', 'theme'],
      apply(ctx) {
        services.theme = ctx.theme;
        services.locale = typeof ctx.get === 'function' ? ctx.get('locale') : undefined;
        services.ctx = ctx;
        ctx.effect(() => {
          const style = document.createElement('style');
          style.setAttribute('data-dsh-theme-toggle', '');
          style.textContent = CSS;
          document.head.appendChild(style);
          return () => style.remove();
        });
        // Windows caption placement (hidden by CSS everywhere else).
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'theme-toggle',
          order: 20,
          label: () => {
            const locale = services.locale;
            const current = locale && typeof locale.getLocale === 'function' ? locale.getLocale() : null;
            return copyFor(current && current.id).toDark;
          },
        }, CaptionAnchor));
        // Sidebar-foot placement (the one the browser and macOS see).
        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'theme-toggle',
          order: 10,
          label: () => {
            const locale = services.locale;
            const current = locale && typeof locale.getLocale === 'function' ? locale.getLocale() : null;
            return copyFor(current && current.id).toDark;
          },
        }, SidebarFootToggle));
      },
    };
  },
});
