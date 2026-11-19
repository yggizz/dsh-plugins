/**
 * dsh-plugin-suite 鈥?Client half.
 *
 * Six independent small features in ONE bundle, each mountable and removable at
 * runtime, plus the Settings page that switches them.
 *
 * Every feature keeps its original factory body verbatim (see
 * `features/client/*.raw.js` and `scripts/build.mjs`): the loader wrapper is
 * replaced by an IIFE that receives the same `require`, so each one still
 * returns its own `{ inject, apply(ctx) }` plugin object. Mounting goes through
 * `ctx.plugin()`, which gives the feature a child Cordis fiber 鈥?every
 * `ctx.effect`, `ctx.slots.inject`, `ctx.on` and `ctx.locale.register` it
 * performs is owned by that fiber, so disposing the fiber removes all of it.
 * That is what makes a switch a real uninstall instead of a CSS hide.
 *
 * Switch state: the Host owns `~/.dsh/plugin-suite.json` and serves it on
 * `/plugins/plugin-suite/state`; this module keeps a localStorage mirror only so
 * the first frame after a reload mounts the right features without a flash. The
 * mirror is never authoritative 鈥?the Host document is.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-suite',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /* ========================= artifact-copy ========================= */
    // Verbatim from features/client/artifact-copy.raw.js (module preamble + factory body).
    const artifactCopy = (function (require) {
/**
 * Artifact copy — Client half.
 *
 * Adds copy entries to the shared right-click menu of a file object. The
 * gesture target `{ kind: 'file', value: { sessionId, path } }` is the shipped
 * one, so every surface that already binds a file menu (delivered-file cards,
 * inline file mentions, the sidebar tree, diff headers) gets these actions
 * without touching another plugin.
 *
 * WHAT IS NOT HERE
 * The shipped `open-in-app` menu already offers「复制文件路径」for this target,
 * so this plugin does not repeat an absolute-path copy. What it adds is what
 * the page cannot do alone: the file itself on the clipboard, its relative
 * path, and its text contents.
 *
 * ORDER
 * 240, after the shipped path/reveal/open rows (100) and the download/save-as
 * rows (200), with a separator: these are additional clipboard forms, not a
 * second copy of the shipped action.
 */

    const React = require('react')
    const h = React.createElement
    const NS = 'artifactCopy'

    const zh = {
      'menu.relative': '复制相对路径',
      'menu.file': '复制文件（可直接粘贴）',
      'menu.folder': '复制文件夹（可直接粘贴）',
      'menu.content': '复制文本内容',
      'done.relative': '已复制相对路径',
      'done.file': '已复制文件，可直接粘贴到资源管理器或聊天窗口',
      'done.folder': '已复制文件夹',
      'done.content': '已复制文本内容',
      'fail.relative': '复制相对路径失败，请重试',
      'fail.file': '复制文件失败：系统剪贴板不可用',
      'fail.content': '复制文本内容失败，请重试',
      'fail.missing': '文件已被移动或删除',
      'fail.tooLarge': '文件超过 1 MB，无法作为文本复制',
      'fail.notText': '这个文件不是文本，无法复制内容',
      'fail.clipboard': '系统剪贴板工具不可用',
    }

    const en = {
      'menu.relative': 'Copy relative path',
      'menu.file': 'Copy file (paste anywhere)',
      'menu.folder': 'Copy folder (paste anywhere)',
      'menu.content': 'Copy text contents',
      'done.relative': 'Relative path copied',
      'done.file': 'File copied — paste it into Explorer or a chat window',
      'done.folder': 'Folder copied',
      'done.content': 'Text contents copied',
      'fail.relative': 'Could not copy the relative path. Try again.',
      'fail.file': 'Could not copy the file: the system clipboard is unavailable',
      'fail.content': 'Could not copy the contents. Try again.',
      'fail.missing': 'The file has been moved or deleted',
      'fail.tooLarge': 'The file is over 1 MB, too large to copy as text',
      'fail.notText': 'This file is not text, so its contents cannot be copied',
      'fail.clipboard': 'The system clipboard tool is unavailable',
    }

    /** Same loopback routes the Host half registers. */
    const COPY_URL = '/plugins/artifact-copy/copy'
    const PROBE_URL = '/plugins/artifact-copy/probe'

    /** Menu resolution budget; the shared popup gives up after about a second. */
    const PROBE_BUDGET_MS = 600

    /** Host error code → localized failure copy. */
    const FAILURE_KEYS = {
      missing: 'fail.missing',
      'too-large': 'fail.tooLarge',
      'not-text': 'fail.notText',
      'not-a-file': 'fail.notText',
      'clipboard-failed': 'fail.clipboard',
    }

    function failureKey(error, fallback) {
      return FAILURE_KEYS[error] ?? fallback
    }

    async function copyViaHost(sessionId, path, mode) {
      const response = await fetch(COPY_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ sessionId, path, mode }),
      })
      let body
      try {
        body = await response.json()
      } catch {
        body = undefined
      }
      if (!response.ok || body?.ok !== true) {
        const error = new Error(body?.error ?? `artifact copy ${response.status}`)
        error.code = typeof body?.error === 'string' ? body.error : 'unknown'
        throw error
      }
      return body
    }

    /**
     * Ask the Host what this path really is, but never hold the menu open for it.
     * @returns file facts, or undefined when the answer did not arrive in time.
     */
    async function probe(sessionId, path, signal) {
      const controller = new AbortController()
      const stop = () => { controller.abort() }
      signal.addEventListener('abort', stop, { once: true })
      const timer = setTimeout(() => { controller.abort() }, PROBE_BUDGET_MS)
      try {
        const response = await fetch(
          `${PROBE_URL}?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`,
          { headers: { accept: 'application/json' }, credentials: 'same-origin', signal: controller.signal },
        )
        if (!response.ok) return undefined
        const body = await response.json()
        return body?.ok === true ? body : undefined
      } catch {
        return undefined
      } finally {
        clearTimeout(timer)
        signal.removeEventListener('abort', stop)
      }
    }

    /* 18px line glyphs, drawn to the optical weight of the shipped icon set. */
    function glyph(paths) {
      return function Glyph() {
        return h('svg', {
          viewBox: '0 0 24 24', width: 18, height: 18, fill: 'none', stroke: 'currentColor',
          strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
        }, ...paths.map((d, index) => h('path', { key: index, d })))
      }
    }

    const GLYPHS = {
      // A path with a leading slash: the relative-path action.
      relative: glyph(['M9 7h7.5a2.5 2.5 0 0 1 0 5H11', 'M11 4.5 8.5 7l2.5 2.5', 'M4 16.5h16']),
      // A sheet with a copy outline behind it: the file-itself action.
      file: glyph(['M10 8.5h5.5l3 3v8.5H10z', 'M15 8.9v3.4h3.2', 'M6.5 15.5v-9h2.2']),
      // Three text rows with a copy outline: the contents action.
      content: glyph(['M8.5 5.5h8v2.4h-8z', 'M10.5 11h8M10.5 14.6h5.6', 'M6 8.4v10.1h2.4']),
    }

    return {
      inject: ['slots', 'locale', 'contextMenus'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'artifact-copy: copy')
        const t = ctx.locale.bind(NS)

        ctx.slots.inject('contextMenu.icon', function* () {
          for (const [key, Glyph] of Object.entries({
            'artifact-copy.relative': GLYPHS.relative,
            'artifact-copy.file': GLYPHS.file,
            'artifact-copy.content': GLYPHS.content,
          })) {
            yield ctx.slots.register({ name: 'contextMenu.icon', key }, Glyph)
          }
        })

        /** Run one mode and report exactly once, through the shared menu toast. */
        const run = async (sessionId, path, mode, doneKey, failKey, isDirectory) => {
          try {
            await copyViaHost(sessionId, path, mode)
          } catch (error) {
            // `failureLabel` on the action reports the generic failure; only a
            // specific code (missing, too large, no clipboard tool) is worth a
            // second, more precise notice, and never the same sentence twice.
            if (error?.code !== undefined) ctx.contextMenus.notify(t(failureKey(error.code, failKey)), false)
            throw error
          }
          ctx.contextMenus.notify(t(isDirectory === true && mode === 'file' ? 'done.folder' : doneKey), true)
        }

        ctx.effect(() => ctx.contextMenus.register({
          id: 'artifact-copy.file', target: 'file', order: 240,
          resolve: async ({ sessionId, path }, signal) => {
            const facts = await probe(sessionId, path, signal)
            signal.throwIfAborted()
            // Unknown is not unavailable: with no answer the entries stay
            // enabled and the Host reports the real reason on click, instead of
            // silently greying out the menu the user just opened.
            const known = facts !== undefined
            const exists = facts?.exists === true
            const directory = facts?.directory === true
            const text = facts?.kind === 'text'
            const present = !known || exists
            return [
              {
                id: 'relative', icon: { key: 'artifact-copy.relative' }, separatorBefore: true,
                label: t('menu.relative'), disabled: !present, failureLabel: t('fail.relative'),
                run: () => run(sessionId, path, 'relative', 'done.relative', 'fail.relative'),
              },
              {
                id: 'file', icon: { key: 'artifact-copy.file' },
                label: t(directory ? 'menu.folder' : 'menu.file'), disabled: !present, failureLabel: t('fail.file'),
                run: () => run(sessionId, path, 'file', 'done.file', 'fail.file', directory),
              },
              {
                // Kept visible and disabled rather than hidden, so the row count
                // stays stable between files of different types.
                id: 'content', icon: { key: 'artifact-copy.content' },
                label: t('menu.content'), disabled: !present || !(known && text),
                failureLabel: t('fail.content'),
                run: () => run(sessionId, path, 'content', 'done.content', 'fail.content'),
              },
            ]
          },
        }), 'artifact-copy: file menu')
      },
    }
    })(require)

    /* ========================= theme-toggle ========================= */
    // Verbatim from features/client/theme-toggle.raw.js (module preamble + factory body).
    const themeToggle = (function (require) {
/**
 * Client half of `@local/theme-toggle`.
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
    })(require)

    /* ========================= turn-credits ========================= */
    // Verbatim from features/client/turn-credits.raw.js (module preamble + factory body).
    const turnCredits = (function (require) {
/**
 * Turn spend — Client half.
 *
 * One compact pill inside a completed reply's action row, beside the harness's
 * own usage and clock: what that Turn actually cost, in the unit the route it
 * used bills in — WorkBuddy credits, or CNY for the DeepSeek routes.
 *
 * The figure comes from the Host, which measures it as a balance difference
 * around the Turn (see index.js); this half only reads and formats it. A reply
 * from a Session that spends on none of the measured routes renders nothing at
 * all, and an unmeasurable Turn renders an em dash rather than a zero.
 */

    const React = require('react')
    const h = React.createElement
    const NS = 'turnSpend'

    const zh = {
      'credits.known': 'WorkBuddy · {amount} 积分',
      'credits.unknown': 'WorkBuddy · —',
      'credits.title': '这一轮实际扣掉的 WorkBuddy 积分：本轮开始与结束时各读一次账号余额，取差值。换号、并发请求或余额尚未结算时显示「—」。',
      'credits.titleUnknown': '这一轮没有测到可比较的余额变化，所以不显示数字。',
      'cny.known': 'DeepSeek · ¥{amount}',
      'cny.unknown': 'DeepSeek · —',
      'cny.title': '这一轮实际花掉的金额：本轮开始与结束时各读一次 DeepSeek 余额，取差值。换号、并发请求或余额尚未结算时显示「—」。',
      'cny.titleUnknown': '这一轮没有测到可比较的余额变化，所以不显示金额。',
    }

    const en = {
      'credits.known': 'WorkBuddy · {amount} credits',
      'credits.unknown': 'WorkBuddy · —',
      'credits.title': 'WorkBuddy credits this turn actually billed: the account balance is read at the start and again at the end of the turn, and the difference is taken. A switched account, overlapping requests, or an unsettled balance shows as an em dash.',
      'credits.titleUnknown': 'No comparable balance change was measured for this turn, so no number is shown.',
      'cny.known': 'DeepSeek · ¥{amount}',
      'cny.unknown': 'DeepSeek · —',
      'cny.title': 'Money this turn actually spent: the DeepSeek balance is read at the start and again at the end of the turn, and the difference is taken. A switched account, overlapping requests, or an unsettled balance shows as an em dash.',
      'cny.titleUnknown': 'No comparable balance change was measured for this turn, so no amount is shown.',
    }

    /**
     * Format one amount for display.
     *
     * Credits are whole-ish numbers and read fine at two decimals. CNY is a
     * currency in which a single Turn can cost a fraction of a cent, so a fixed
     * two decimals would print ¥0.00 for real spending; small values therefore
     * keep three decimals, and anything below ¥0.001 reads as `<0.001`.
     */
    function formatAmount(value, unit) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined
      if (unit === 'CNY') {
        if (value > 0 && value < 0.001) return '<0.001'
        const decimals = value < 1 ? 3 : 2
        const fixed = value.toFixed(decimals)
        return fixed.replace(/0+$/, '').replace(/\.$/, '')
      }
      if (value > 0 && value < 0.01) return '<0.01'
      const fixed = value.toFixed(2)
      return fixed.endsWith('.00') ? fixed.slice(0, -3) : fixed.endsWith('0') ? fixed.slice(0, -1) : fixed
    }

    const styles = {
      pill: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        fontSize: '12px',
        lineHeight: '16px',
        color: 'var(--dsw-alias-label-secondary)',
        whiteSpace: 'nowrap',
        userSelect: 'none',
        fontVariantNumeric: 'tabular-nums',
      },
      dot: {
        width: '5px',
        height: '5px',
        borderRadius: '50%',
        background: 'var(--dsw-alias-state-success-primary)',
        flex: '0 0 auto',
      },
      dotUnknown: {
        width: '5px',
        height: '5px',
        borderRadius: '50%',
        background: 'var(--dsw-alias-state-idle-primary)',
        flex: '0 0 auto',
      },
    }

    /** Figures keyed by `<sessionId>:<messageId>`; a mounted row remounts resolved. */
    const cache = new Map()

    /**
     * Delays before re-asking for a reply whose figure has not arrived.
     *
     * WorkBuddy settles within a second of `turn/end`, but the DeepSeek wallet
     * settles in batches that can lag minutes, so a CNY figure often lands well
     * after this row mounted. The schedule therefore keeps asking for about four
     * minutes and then stops, which bounds the cost of a Turn that never settles
     * while still catching the delayed ones.
     */
    const RETRY_DELAYS_MS = [1200, 2500, 4000, 8000, 15000, 30000, 45000, 45000, 60000]

    async function fetchAmount(sessionId, messageId, signal) {
      const response = await fetch(
        `/plugins/turn-spend/state?sessionId=${encodeURIComponent(sessionId)}&messageId=${encodeURIComponent(messageId)}`,
        { headers: { accept: 'application/json' }, credentials: 'same-origin', signal },
      )
      if (!response.ok) throw new Error(`turn spend ${response.status}`)
      return response.json()
    }

    function TurnSpend(props) {
      const { sessionId, messageId, t } = props
      const key = sessionId === undefined || messageId === undefined ? undefined : `${sessionId}:${messageId}`
      const [state, setState] = React.useState(() => (key === undefined ? undefined : cache.get(key)))

      React.useEffect(() => {
        if (key === undefined) return undefined
        const controller = new AbortController()
        let live = true
        let timer

        const read = attempt => {
          fetchAmount(sessionId, messageId, controller.signal)
            .then(body => {
              if (!live) return
              const unit = body?.unit
              const amount = typeof body?.amount === 'number' && Number.isFinite(body.amount) ? body.amount : undefined
              const owned = unit === 'credits' || unit === 'CNY'
              const next = { owned, unit: owned ? unit : undefined, amount }
              setState(previous => (
                previous !== undefined && previous.owned === next.owned && previous.unit === next.unit && previous.amount === next.amount
                  ? previous
                  : next
              ))
              cache.set(key, next)
              if (amount !== undefined) return
              const delay = RETRY_DELAYS_MS[attempt]
              if (delay !== undefined) timer = setTimeout(() => read(attempt + 1), delay)
            })
            .catch(() => {})
        }
        read(0)

        return () => {
          live = false
          if (timer !== undefined) clearTimeout(timer)
          controller.abort()
        }
      }, [key, sessionId, messageId])

      if (key === undefined || state === undefined || !state.owned) return null
      const unit = state.unit
      const text = formatAmount(state.amount, unit)
      if (text === undefined) {
        return h('span', { style: styles.pill, title: t(`${unit === 'CNY' ? 'cny' : 'credits'}.titleUnknown`) },
          h('span', { style: styles.dotUnknown }),
          h('span', null, t(`${unit === 'CNY' ? 'cny' : 'credits'}.unknown`)))
      }
      return h('span', { style: styles.pill, title: t(`${unit === 'CNY' ? 'cny' : 'credits'}.title`) },
        h('span', { style: styles.dot }),
        h('span', null, t(`${unit === 'CNY' ? 'cny' : 'credits'}.known`, { amount: text })))
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'turn-spend: copy')
        const t = ctx.locale.bind(NS)
        ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
          name: 'conversation.chat.assistant-actions',
          id: 'turn-spend',
          order: 20,
          locale: NS,
          inject: sessionId => ({ t, sessionId }),
        }, TurnSpend))
      },
    }
    })(require)

    /* ========================= hide-branch ========================= */
    // Verbatim from features/client/hide-branch.raw.js (module preamble + factory body).
    const hideBranch = (function (require) {
// Hides the per-message "branch into a new conversation" action.
//
// The shipped Chat UI renders that action as a plain icon button whose only
// stable, language-independent-enough handle is its accessible label, taken
// from the `message.branch` locale entry (and `message.branchUnavailable` for
// the disabled variant). The label list below mirrors every locale the
// installed Chat package ships, so the rule keeps working when the UI language
// changes.
const BRANCH_LABELS = [
  '在新对话中分支',
  'Branch into a new conversation',
  '新しい会話に分岐',
  'Pasar a una nueva conversación',
  'Lancez-vous dans une nouvelle conversation',
  'Verzweigen Sie in ein neues Gespräch',
  'Перейти к новому разговору',
  'Ramifique para uma nova conversa',
]

function selectorFor(labels) {
  return labels
    .map((label) => `button[aria-label="${label.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`)
    .join(',')
}

    const CSS = `${selectorFor(BRANCH_LABELS)}{display:none!important}`

    return {
      apply(ctx) {
        ctx.effect(() => {
          const style = document.createElement('style')
          style.setAttribute('data-dsh-hide-branch', '')
          style.textContent = CSS
          document.head.appendChild(style)
          return () => style.remove()
        })
      },
    }
    })(require)

    /* ========================= sidebar-pins ========================= */
    // Verbatim from features/client/sidebar-pins.raw.js (module preamble + factory body).
    const sidebarPins = (function (require) {
/**
 * Client half of `@local/sidebar-pins`.
 *
 * The shipped sidebar keeps its unpinned-panel list in memory only
 * (`createPanelPins` in `@deepseek-ai/dsh-client-ui-sidebar`), so a reload or
 * restart puts every launcher back into the left sidebar. This module records
 * the launchers you unpin, keeps the list in `localStorage` plus a cookie
 * (cookies ignore the port, which changes between Desktop launches), and
 * replays the same unpin action early on every start.
 */

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
    })(require)

    /* ========================= rightbar-default-open ========================= */
    // Verbatim from features/client/rightbar-default-open.raw.js (module preamble + factory body).
    const rightbarDefaultOpen = (function (require) {
/**
 * Client half of `@local/rightbar-default-open`.
 *
 * DSH's right Sidebar (`@deepseek-ai/dsh-client-ui-sidebar-right`) starts every
 * session COLLAPSED: `createSurface()` builds the docking surface with
 * `expanded: false`, and the column only opens when you open something into it
 * or press the expand control. The expanded flag is then persisted per session
 * in `localStorage` under `dsh.sidebar-right.v1.<sessionId>`, so a session you
 * once opened comes back open — but a brand-new session always starts closed.
 *
 * This module flips that default: as soon as a session comes on screen, the
 * column is expanded once. The decision is made once per session per page load
 * (`handled`), so collapsing the column afterwards stays collapsed; a reload
 * opens it again, which is exactly what "default open" means.
 *
 * How it talks to the host: only through the public `ctx.sidebarRight` face —
 * `mounted` (the on-screen session), `isExpanded()` and `toggleExpanded()`.
 * There is no `setExpanded` on that face, so the module reads first and only
 * toggles when the column is actually collapsed; calling toggle blindly would
 * close a column the user had open.
 *
 * The surface is minted by the seat during the same render that publishes
 * `mounted`, so the first attempt can land before the store exists — the
 * controller then throws `no session surface is mounted`. Every attempt is
 * therefore guarded and retried on a short schedule until `isExpanded()` reads
 * true, and the session is only marked handled once that is observed.
 *
 * Narrow viewports are left alone: below 768px the host presents an expanded
 * column FULLSCREEN, so auto-opening would cover the conversation on every
 * launch. The column stays collapsed there and the expand control still works.
 */

    /** Below this frame width an expanded column is drawn fullscreen by the host. */
    const NARROW_WIDTH = 768;
    /** Retry schedule (ms) for a surface that is not minted yet. */
    const RETRY_DELAYS = [0, 60, 160, 360, 700, 1200, 2000, 3200];

    return {
      inject: [],
      apply(ctx) {
        /** Sessions already opened by this page load; collapsing afterwards is respected. */
        const handled = new Set();
        /** Live retry timers, cleared on teardown. */
        const timers = new Set();
        let disposed = false;
        let unsubscribe = null;
        let waitTimer = null;

        // The controller is provided through `ctx.reflect.provide('sidebarRight')`;
        // `ctx.get` is the late-binding read (the service can arrive after this
        // module loads), and the plain property is the same object once it exists.
        const column = () => {
          try {
            if (typeof ctx.get === 'function') {
              const provided = ctx.get('sidebarRight');
              if (provided !== undefined && provided !== null) return provided;
            }
          } catch (_error) {
            /* service not provided yet */
          }
          return ctx.sidebarRight;
        };

        const narrow = () => typeof window !== 'undefined'
          && typeof window.innerWidth === 'number'
          && window.innerWidth > 0
          && window.innerWidth < NARROW_WIDTH;

        /**
         * Try to expand the column for one session.
         * @param sessionId - the session the host reports as on screen.
         * @param attempt - index into {@link RETRY_DELAYS}.
         */
        const attempt = (sessionId, attemptIndex) => {
          if (disposed || handled.has(sessionId)) return;
          const face = column();
          if (face === undefined || typeof face.isExpanded !== 'function') return;
          if (narrow()) return;
          // A session switch during a retry series must not open the wrong one.
          const onScreen = face.mounted && typeof face.mounted.getSnapshot === 'function'
            ? face.mounted.getSnapshot()
            : undefined;
          if (onScreen !== sessionId) return;
          try {
            if (face.isExpanded() === true) {
              handled.add(sessionId);
              return;
            }
            face.toggleExpanded();
            if (face.isExpanded() === true) {
              handled.add(sessionId);
              return;
            }
          } catch (_error) {
            /* The session's store is not minted yet: retry below. */
          }
          schedule(sessionId, attemptIndex + 1);
        };

        const schedule = (sessionId, attemptIndex) => {
          if (disposed || attemptIndex >= RETRY_DELAYS.length) return;
          const timer = window.setTimeout(() => {
            timers.delete(timer);
            attempt(sessionId, attemptIndex);
          }, RETRY_DELAYS[attemptIndex]);
          timers.add(timer);
        };

        /** React to the on-screen session: open the column the first time each one appears. */
        const onMounted = () => {
          const face = column();
          const sessionId = face && face.mounted && typeof face.mounted.getSnapshot === 'function'
            ? face.mounted.getSnapshot()
            : undefined;
          if (sessionId === undefined || handled.has(sessionId)) return;
          attempt(sessionId, 0);
        };

        /** Bind to the controller once it is provided; it can arrive after this module loads. */
        const ensureBound = () => {
          if (disposed) return;
          const face = column();
          if (face === undefined || !face.mounted || typeof face.mounted.subscribe !== 'function') {
            waitTimer = window.setTimeout(ensureBound, 250);
            return;
          }
          unsubscribe = face.mounted.subscribe(onMounted);
          onMounted();
        };

        ensureBound();

        ctx.effect(() => () => {
          disposed = true;
          if (waitTimer !== null) window.clearTimeout(waitTimer);
          for (const timer of timers) window.clearTimeout(timer);
          timers.clear();
          if (typeof unsubscribe === 'function') unsubscribe();
          unsubscribe = null;
        });
      },
    };
    })(require)

    /** The switchable features, in settings-page order. */
    const FEATURES = [
      { id: "artifact-copy", plugin: artifactCopy },
      { id: "theme-toggle", plugin: themeToggle },
      { id: "turn-credits", plugin: turnCredits },
      { id: "hide-branch", plugin: hideBranch },
      { id: "sidebar-pins", plugin: sidebarPins },
      { id: "rightbar-default-open", plugin: rightbarDefaultOpen },
    ]

    /** Dictionaries, flattened to the dotted keys `t()` looks up. */
    const DICTIONARIES = {
      zh: {
            "settings.title": "小插件",
            "settings.nav": "小插件",
            "settings.subtitle": "管理套件里的六个独立功能，开关即时生效。",
            "settings.enableAll": "全部开启",
            "settings.disableAll": "全部关闭",
            "settings.saved": "配置保存在",
            "settings.loadFailed": "读取配置失败，显示的是上次缓存的开关状态。",
            "settings.saveFailed": "保存失败，开关已回退。",
            "settings.busy": "正在应用…",
            "settings.features.artifact-copy.title": "文件右键复制",
            "settings.features.artifact-copy.description": "在对话里的文件上右键，复制路径、相对路径、文件内容或文件本体。",
            "settings.features.theme-toggle.title": "深浅色切换",
            "settings.features.theme-toggle.description": "标题栏（Windows 客户端）或侧栏底部一个按钮切换明暗主题。",
            "settings.features.turn-credits.title": "每轮花费",
            "settings.features.turn-credits.description": "在每条回复的操作行显示这一轮实际花掉的积分或人民币。",
            "settings.features.hide-branch.title": "隐藏「分支到新会话」",
            "settings.features.hide-branch.description": "去掉助手消息上那个分支按钮。",
            "settings.features.sidebar-pins.title": "记住取消固定的面板",
            "settings.features.sidebar-pins.description": "重启后仍然保持你取消固定的侧栏面板。",
            "settings.features.rightbar-default-open.title": "右侧栏默认展开",
            "settings.features.rightbar-default-open.description": "会话出现时自动展开右栏；窄于 768px 不展开，避免遮住对话。"},
      en: {
            "settings.title": "Plugin suite",
            "settings.nav": "Plugin suite",
            "settings.subtitle": "Manage the six independent features. Changes apply immediately.",
            "settings.enableAll": "Enable all",
            "settings.disableAll": "Disable all",
            "settings.saved": "Configuration saved in",
            "settings.loadFailed": "Could not read the configuration; showing the last cached switch state.",
            "settings.saveFailed": "Save failed; the switch was reverted.",
            "settings.busy": "Applying…",
            "settings.features.artifact-copy.title": "File right-click copy",
            "settings.features.artifact-copy.description": "Right-click a file in the conversation to copy its path, relative path, contents, or the file itself.",
            "settings.features.theme-toggle.title": "Theme toggle",
            "settings.features.theme-toggle.description": "One button in the window caption (Windows) or at the sidebar foot switches light and dark.",
            "settings.features.turn-credits.title": "Per-turn spend",
            "settings.features.turn-credits.description": "Shows what each completed turn cost, in credits or CNY, on that reply's action row.",
            "settings.features.hide-branch.title": "Hide \"branch into a new conversation\"",
            "settings.features.hide-branch.description": "Removes the branch button from assistant messages.",
            "settings.features.sidebar-pins.title": "Remember unpinned panels",
            "settings.features.sidebar-pins.description": "Keeps the sidebar panels you unpinned unpinned after a restart.",
            "settings.features.rightbar-default-open.title": "Right sidebar open by default",
            "settings.features.rightbar-default-open.description": "Expands the right column when a session appears; left alone under 768px so it never covers the conversation."},
    }

    /** localStorage mirror key; the Host document remains authoritative. */
    const MIRROR_KEY = 'dsh.plugin-suite.v1'
    /** The six switchable features, by id, in page order. */
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
        if (!response.ok) throw new Error(`state ${response.status}`)
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
        if (!response.ok) throw new Error(`save ${response.status}`)
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
        if (!response.ok) throw new Error(`save ${response.status}`)
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
      const label = key => t(`settings.features.${key}.title`)
      const describe = key => t(`settings.features.${key}.description`)
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
