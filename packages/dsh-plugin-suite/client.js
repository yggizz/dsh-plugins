/**
 * dsh-plugin-suite 鈥?Client half.
 *
 * Ten independent small features in ONE bundle, each mountable and removable at
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
 * One placement everywhere: the sidebar foot (`sidebar.footer.action`) — a
 * full row while the column is wide, a centered icon once it collapses to the
 * 56px rail, a drawer entry in drawer mode. The desktop client used to draw a
 * second copy in the Windows caption band; 2026-11-20 the user asked for the
 * two clients to look the same, so the caption copy is no longer drawn.
 *
 * The caption seat stays registered, and is only drawn in the states where the
 * column renders no foot at all (a collapsed rail on desktop): the sidebar
 * button sets `data-dsh-theme-foot` on <html> while mounted, and the caption
 * anchor is hidden whenever that marker is present.
 *
 * The caption seat, when it does appear, follows the sidebar instead of a
 * frozen coordinate: the preload's Application/Edit menubar is anchored at
 * `--dsh-windows-menu-start` (48px expanded, 84px collapsed), so a hard-coded
 * `left` lands correctly in one state and jams against the neighbours in the
 * other. The anchor measures the live menubar box and any neighbouring caption
 * group carrying `[data-dsh-refresh-restart]` (that attribute used to be set by
 * the refresh/restart feature, which this bundle no longer ships, so the query
 * normally returns nothing and the anchor falls back to the menubar's right
 * edge). It re-places itself on the same events the shell animates on: the
 * collapse/expand track transition, a window resize, a click or keypress that
 * changes the caption, and a locale change that widens the menu labels.
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
    const services = { theme: undefined, locale: undefined, ctx: undefined, forms: undefined };

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

    /* ---------------------------------------------------------- write guard *
     * The preference lives in the profile patch, and that one file is rewritten
     * wholesale by a crowd of other plugins (fast-mode rewrites its whole
     * session map on every new conversation; the market writes the file with a
     * plain `writeFileSync`). A click can therefore land on a refused write
     * (`settings-conflict`, because `ui-theme` writes carry an
     * `expectedRevision`), and `ThemeRuntime.write()` only uses `.finally()` —
     * it never inspects the result — so `adopt()` immediately re-applies the
     * durable value and the UI flips back a few seconds later with no error
     * anywhere.
     *
     * The guard re-issues the click while its window is open, but only for a
     * flip back to the exact value that click replaced: a deliberate change to
     * any other value (the Settings page, another plugin) is left alone, and a
     * persistent refusal stops after GUARD_RETRIES instead of looping.
     */
    /** How long after a click a flip-back still counts as a lost write. */
    const GUARD_WINDOW_MS = 8000;
    /** Re-issues allowed inside one window. */
    const GUARD_RETRIES = 3;
    /** Spacing between re-issues, multiplied by the attempt number. */
    const GUARD_STEP_MS = 400;

    /** The click being protected: what it asked for, what it replaced, when it expires. */
    const guard = { desired: null, previous: null, until: 0, attempts: 0, timer: null };

    /** Drop the guard and any pending re-issue. */
    function guardReset() {
      guard.desired = null;
      guard.previous = null;
      guard.until = 0;
      guard.attempts = 0;
      if (guard.timer !== null) {
        clearTimeout(guard.timer);
        guard.timer = null;
      }
    }

    /**
     * Write one preference and arm the guard for the next few seconds.
     * @param nextId - the theme id the click asked for.
     */
    function toggleTheme(nextId) {
      const theme = services.theme;
      if (!theme || typeof theme.setTheme !== 'function') return;
      const current = typeof theme.getTheme === 'function' ? theme.getTheme() : null;
      guard.previous = current && current.preference ? current.preference : null;
      guard.desired = nextId;
      guard.until = Date.now() + GUARD_WINDOW_MS;
      guard.attempts = 0;
      theme.setTheme(nextId);
    }

    /**
     * The preference the profile currently persists, when it is readable.
     * A bounce to the old value with this already holding the new one is
     * somebody else's deliberate choice (the Settings page, another plugin),
     * not a lost write — so the guard stays out of it.
     * @returns the durable preference, or undefined when the form is absent.
     */
    function durablePreference() {
      const forms = services.forms;
      if (!forms || typeof forms.get !== 'function') return undefined;
      try {
        const form = forms.get('ui-theme');
        const snapshot = form && typeof form.getSnapshot === 'function' ? form.getSnapshot() : undefined;
        // `value` is the resolved section — the same layer `adopt()` re-applies.
        const section = snapshot && snapshot.value;
        return section && typeof section.preference === 'string' ? section.preference : undefined;
      } catch {
        return undefined;
      }
    }

    /**
     * Re-issue a click whose write was lost.
     * @param snapshot - the snapshot published by `theme/change`.
     */
    function guardTheme(snapshot) {
      const preference = snapshot && snapshot.preference;
      if (guard.desired === null || preference === guard.desired) return;
      // Anything other than a bounce back to the replaced value is the user's
      // own new choice, not a lost write.
      if (preference !== guard.previous) return guardReset();
      // The durable layer already holds what the click asked for: the write
      // landed and this bounce is a deliberate later choice.
      if (durablePreference() === guard.desired) return guardReset();
      if (Date.now() > guard.until || guard.attempts >= GUARD_RETRIES) return guardReset();
      guard.attempts += 1;
      if (guard.timer !== null) clearTimeout(guard.timer);
      guard.timer = setTimeout(() => {
        guard.timer = null;
        if (guard.desired === null) return;
        const theme = services.theme;
        if (theme && typeof theme.setTheme === 'function') theme.setTheme(guard.desired);
      }, GUARD_STEP_MS * guard.attempts);
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
      // Marks <html> while this seat is mounted. The caption seat (Windows) is
      // hidden by CSS whenever this attribute is present, so exactly one button
      // is ever drawn and the placement follows whichever seat the column
      // actually renders.
      React.useEffect(() => {
        const root = document.documentElement;
        if (root === null) return undefined;
        root.setAttribute('data-dsh-theme-foot', '');
        return () => root.removeAttribute('data-dsh-theme-foot');
      }, []);
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
      // One placement everywhere: the sidebar foot. The button lives at the
      // bottom of the sidebar on every platform, so the desktop client and the
      // browser look the same. The Windows caption seat stays registered as a
      // fallback for the states where the column renders no foot at all
      // (collapsed rail on desktop): the sidebar button announces itself by
      // setting `data-dsh-theme-foot` on <html> while mounted, so the caption
      // button is hidden exactly when the foot one exists and comes back if the
      // foot goes away. The caption anchor is also hidden outright on any host
      // without a caption band.
      'html:not([data-windows-titlebar]) .dsh-theme-toggle-anchor{display:none;}',
      'html[data-dsh-theme-foot] .dsh-theme-toggle-anchor{display:none;}',
      // Hide the WeChat remote launcher in the sidebar foot. That plugin always
      // registers into `sidebar.footer.action` with no config switch of its own,
      // and its Settings entry stays reachable from the Settings panel, so the
      // foot copy is redundant. Targeted by the shell's own `data-slot` marker
      // plus the plugin's literal aria-label, not by its hashed class name, so a
      // restyle of that plugin does not silently bring the row back. Removing
      // this rule restores the button.
      '[data-slot="sidebar.footer.action"] button[aria-label="\u5fae\u4fe1\u8fde\u63a5"]{display:none;}',
    ].join('');

    return {
      inject: ['slots', 'theme'],
      apply(ctx) {
        services.theme = ctx.theme;
        services.locale = typeof ctx.get === 'function' ? ctx.get('locale') : undefined;
        services.forms = typeof ctx.get === 'function' ? ctx.get('configForms') : undefined;
        services.ctx = ctx;
        // Feature-level, not hook-level: the guard has to watch the flip-back
        // that happens seconds after a click, whether or not a button is
        // currently mounted in a seat the column happens to render.
        ctx.effect(() => {
          const off = ctx.on('theme/change', (snapshot) => guardTheme(snapshot));
          return () => {
            off();
            guardReset();
          };
        }, 'theme-toggle: write guard');
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
 *
 * Why the More menu needs its own row lookup: the menu draws one entry as
 * `<div class=sidebarEntry><launcher/><span class=pinAnchor><pin/></span></div>`
 * — the pin control sits one wrapper deeper than the launcher, so the row is
 * the nearest ancestor holding exactly two `button[role="menuitem"]`, not the
 * pin button's direct parent. Reading the direct parent (the old rule) could
 * never match, so every pin click went unnoticed and the replay immediately
 * put the launcher back into More.
 */

    /** Same JSON list in both places; the cookie survives an origin port change. */
    const STORE_KEY = 'dsh.sidebar.pins.v1';
    const COOKIE_KEY = 'dsh_sidebar_pins_v1';
    const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
    /** Do not retry one launcher more often than this after a replay click. */
    const RETRY_MS = 2500;
    /** Collapse one burst of DOM mutations into one replay pass. */
    const SETTLE_MS = 250;
    /** A just-pinned launcher is left alone this long, whatever the DOM does. */
    const PINNED_QUIET_MS = 2000;

    const desired = new Set(readNames());
    const lastClick = new Map();
    /** Launcher name → when it was pinned by hand; replay skips the quiet window. */
    const pinnedAt = new Map();
    let observer;
    let settleTimer;
    let disposers = [];

    function isName(value) {
      return typeof value === 'string' && value.trim().length > 0;
    }

    /** One panel name as both the sidebar row and the More menu spell it. */
    function normalize(value) {
      return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
    }

    function parseNames(raw) {
      if (!isName(raw)) return [];
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.map(normalize).filter(isName) : [];
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
        rows.push({ name: normalize(button.getAttribute('aria-label')), unpin });
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
      return normalize(other.getAttribute('aria-label'));
    }

    /**
     * The row inside one open menu that holds this control and its launcher.
     *
     * The launcher and the pin control are not siblings: each may sit inside a
     * positioning wrapper of its own, so the row is the first ancestor of the
     * clicked control that contains exactly two menu items and still lies
     * inside the menu itself.
     * @param button - the clicked control.
     * @returns both menu items of the row, or null outside a menu.
     */
    function menuRow(button) {
      const menu = typeof button.closest === 'function' ? button.closest('[role="menu"]') : null;
      if (menu === null) return null;
      let node = button.parentElement;
      while (node !== null && node !== menu) {
        const items = [...node.querySelectorAll('button[role="menuitem"]')];
        if (items.length === 2) return items;
        node = node.parentElement;
      }
      return null;
    }

    /** The clicked control is the More menu's pin action: report its row label. */
    function pinTarget(button) {
      if ((button.getAttribute('role') || '') !== 'menuitem') return null;
      /* The pin action is icon-only; the launcher row beside it carries the text. */
      if ((button.textContent || '').trim().length !== 0) return null;
      const pair = menuRow(button);
      if (pair === null) return null;
      const launcher = pair.find(item => item !== button && (item.textContent || '').trim().length > 0);
      if (launcher === undefined) return null;
      const name = normalize(launcher.textContent);
      return name.length > 0 ? name : null;
    }

    function addName(name) {
      const key = normalize(name);
      if (!isName(key) || desired.has(key)) return;
      desired.add(key);
      pinnedAt.delete(key);
      persist();
      apply();
    }

    function removeName(name) {
      const key = normalize(name);
      if (!isName(key)) return;
      /* Recorded even when the name was already gone: the replay may still be armed. */
      pinnedAt.set(key, Date.now());
      if (!desired.has(key)) return;
      desired.delete(key);
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
        if (now - (pinnedAt.get(name) || 0) < PINNED_QUIET_MS) continue;
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
          pinned: name => pinnedAt.has(normalize(name)),
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
 * once opened comes back open — but a brand-new session starts closed.
 *
 * This module flips that default: when a session comes on screen the column is
 * expanded for it. The decision is made once per session per page load
 * (`settled`), so collapsing the column afterwards stays collapsed until the
 * next reload — which is what "default open, but I may still close it" means.
 *
 * How it talks to the host: only through the public `ctx.sidebarRight` face —
 * `mounted` (the on-screen session), `isExpanded()` and `toggleExpanded()`.
 * There is no `setExpanded` on that face, so the module reads first and only
 * toggles when the column is actually collapsed; calling toggle blindly would
 * close a column the user had open.
 *
 * The seat refuses an expansion it cannot afford: `RightbarSeat` collapses a
 * shown panel again as soon as `canShow` is false (the frame needs
 * `viewport − sidebar − 400 ≥ 300`). So "did it stay open" is read back from
 * `isExpanded()` rather than assumed from the toggle call: one verification
 * after the commit, and on a slow mint the whole attempt is re-armed on a
 * watch window an order of magnitude longer than the old fixed ladder. Two
 * refused attempts settle the session as "no room", so a narrow window gets no
 * open/shut flicker and no retry storm.
 *
 * Narrow viewports stay collapsed on purpose: below 768px the host presents an
 * expanded column FULLSCREEN, so auto-opening would cover the conversation.
 * The expand control still works there.
 */

    /** Below this frame width an expanded column is drawn fullscreen by the host. */
    const NARROW_WIDTH = 768;
    /** Watch window for a session whose surface or room is not ready yet. */
    const WATCH_MS = 30000;
    /** Re-arm interval inside the watch window. */
    const RETRY_MS = 400;
    /** Let the seat's commit land before reading `isExpanded()` back. */
    const VERIFY_MS = 300;
    /** How many refused expansions settle a session as "no room on this frame". */
    const MAX_REFUSALS = 2;

    return {
      inject: [],
      apply(ctx) {
        /** Sessions with a final answer for this page load; later collapses are respected. */
        const settled = new Set();
        /** Session → how many expansions were asked for and did not stay. */
        const refusals = new Map();
        /** Session → its single pending timer. */
        const timers = new Map();
        let disposed = false;
        let unsubscribe = null;
        let waitTimer = null;

        const clearTimer = sessionId => {
          const timer = timers.get(sessionId);
          if (timer === undefined) return;
          window.clearTimeout(timer);
          timers.delete(sessionId);
        };

        const later = (sessionId, delay, run) => {
          clearTimer(sessionId);
          const timer = window.setTimeout(() => {
            timers.delete(sessionId);
            run();
          }, delay);
          timers.set(sessionId, timer);
        };

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

        /** The session the host reports as on screen, if the face is bound. */
        const onScreenSession = face => face !== undefined && face.mounted
          && typeof face.mounted.getSnapshot === 'function'
          ? face.mounted.getSnapshot()
          : undefined;

        const expandedNow = face => {
          try {
            return typeof face.isExpanded === 'function' && face.isExpanded() === true;
          } catch (_error) {
            /* The session's store is not minted yet. */
            return false;
          }
        };

        /** Give up retrying, but let the expand control keep working by hand. */
        const settle = sessionId => {
          clearTimer(sessionId);
          settled.add(sessionId);
        };

        const arm = (sessionId, sessionIdFn, deadline) => {
          if (disposed || settled.has(sessionId)) return;
          const remaining = deadline - Date.now();
          if (remaining <= 0) {
            settle(sessionId);
            return;
          }
          later(sessionId, Math.min(RETRY_MS, remaining), () => { attempt(sessionId, deadline) });
        };

        /**
         * Ask for one expansion and verify it stayed.
         * @param sessionId - the session the host reports as on screen.
         * @param deadline - when to stop watching.
         */
        const attempt = (sessionId, deadline) => {
          if (disposed || settled.has(sessionId)) return;
          const face = column();
          if (face === undefined || typeof face.isExpanded !== 'function') {
            arm(sessionId, deadline);
            return;
          }
          if (narrow()) {
            settle(sessionId);
            return;
          }
          // A session switch during a watch must not open the wrong one.
          if (onScreenSession(face) !== sessionId) return;
          if (expandedNow(face)) {
            settle(sessionId);
            return;
          }
          try {
            face.toggleExpanded();
          } catch (_error) {
            // No surface yet: the seat mints it a moment later, so keep watching.
            arm(sessionId, deadline);
            return;
          }
          later(sessionId, VERIFY_MS, () => {
            if (disposed || settled.has(sessionId)) return;
            const live = column();
            if (expandedNow(live)) {
              settle(sessionId);
              return;
            }
            const count = (refusals.get(sessionId) || 0) + 1;
            refusals.set(sessionId, count);
            if (count >= MAX_REFUSALS) {
              // The seat folded it back: this frame has no room for the column.
              settle(sessionId);
              return;
            }
            arm(sessionId, deadline);
          });
        };

        /** Open the column for whichever session just came on screen. */
        const onMounted = () => {
          const face = column();
          const sessionId = onScreenSession(face);
          if (sessionId === undefined || settled.has(sessionId) || timers.has(sessionId)) return;
          attempt(sessionId, Date.now() + WATCH_MS);
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

        window.__dshRightbarDefaultOpen = {
          settled: () => [...settled],
          refusals: () => Object.fromEntries(refusals),
          /** Forget the decisions and try once more, e.g. after widening the window. */
          retry: () => {
            for (const sessionId of [...timers.keys()]) clearTimer(sessionId);
            settled.clear();
            refusals.clear();
            onMounted();
          },
        };

        ctx.effect(() => () => {
          disposed = true;
          if (waitTimer !== null) window.clearTimeout(waitTimer);
          for (const timer of timers.values()) window.clearTimeout(timer);
          timers.clear();
          if (typeof unsubscribe === 'function') unsubscribe();
          unsubscribe = null;
          delete window.__dshRightbarDefaultOpen;
        });
      },
    };
    })(require)

    /* ========================= archive-filter-toggle ========================= */
    // Verbatim from features/client/archive-filter-toggle.raw.js (module preamble + factory body).
    const archiveFilterToggle = (function (require) {
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
    })(require)

    /* ========================= approval-zh ========================= */
    // Verbatim from features/client/approval-zh.raw.js (module preamble + factory body).
    const approvalZh = (function (require) {
/**
 * dsh-approval-zh — browser half.
 *
 * Takes over the composer chain for one pending tool approval (priority 0.5:
 * after the question composers, before the shipped approval panel at 1) and
 * renders the SAME shared approval card, only with a Chinese headline.
 *
 * The headline arrives as `displayReason`/`reason` from the requester; DSH's
 * own escalation prose is partly English. The Host half owns the translation;
 * this half asks it only when the active UI language is Chinese and the
 * headline still carries English, then swaps the text in place. Every failure
 * keeps the original headline, so the approval stays answerable.
 */

    const React = require('react')

    const ROUTE = '/api/dsh-approval-zh/translate'
    const STORAGE_PREFIX = 'dsh-approval-zh:v1:'

    function isChinese(locale) {
      if (typeof locale !== 'string') return false
      const lower = locale.toLowerCase()
      return lower === 'zh' || lower.startsWith('zh-') || lower.startsWith('zh_')
    }

    function hasEnglish(text) {
      return /[A-Za-z]{2,}/.test(text)
    }

    /** Stable per-headline key for the session cache (FNV-1a). */
    function fingerprint(text) {
      let value = 2166136261
      for (let index = 0; index < text.length; index += 1) {
        value ^= text.charCodeAt(index)
        value = Math.imul(value, 16777619)
      }
      return (value >>> 0).toString(36) + ':' + text.length
    }

    function readStored(key) {
      try { return window.sessionStorage.getItem(key) } catch { return null }
    }

    function writeStored(key, value) {
      try { window.sessionStorage.setItem(key, value) } catch { /* storage is best-effort */ }
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const approvalT = ctx.locale.bind('approval')
        const inFlight = new Map()

        const translate = (text) => {
          const known = inFlight.get(text)
          if (known !== undefined) return known
          const key = STORAGE_PREFIX + fingerprint(text)
          const stored = readStored(key)
          if (stored !== null && stored !== '') {
            const done = Promise.resolve(stored)
            inFlight.set(text, done)
            return done
          }
          const work = fetch(ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text }),
            cache: 'no-store',
          })
            .then((response) => (response.ok ? response.json() : null))
            .then((payload) => (payload && payload.ok === true && typeof payload.text === 'string'
              && payload.changed === true && payload.text.trim() !== '' ? payload.text : text))
            .catch(() => text)
            .then((out) => {
              if (out !== text) writeStored(key, out)
              return out
            })
          inFlight.set(text, work)
          return work
        }

        const activeLocale = () => ctx.locale.getLocale().active

        /** Exactly the shipped panel's headline, before any translation. */
        function headline(approval) {
          if (approval.displayReason !== undefined) {
            if (typeof ctx.locale.resolveText === 'function') {
              try { return String(ctx.locale.resolveText(approval.displayReason)) } catch { /* fall through */ }
            }
            return String(approval.displayReason[activeLocale()] ?? approval.displayReason.en ?? '')
          }
          return approval.reason ?? approvalT('escalation', { toolName: approval.toolName })
        }

        function ApprovalZhPanel(props) {
          const approval = props.matched
          const [locale, setLocale] = React.useState(activeLocale)
          React.useEffect(() => ctx.locale.subscribe(() => setLocale(activeLocale())), [])

          const base = headline(approval)
          const chinese = isChinese(locale)
          const [title, setTitle] = React.useState(base)

          React.useEffect(() => {
            setTitle(base)
            if (!chinese || !hasEnglish(base)) return undefined
            let cancelled = false
            translate(base).then((out) => {
              if (!cancelled && typeof out === 'string' && out.trim() !== '') setTitle(out)
            }).catch(() => { /* the original headline stays */ })
            return () => { cancelled = true }
          }, [base, chinese])

          return props.renderFactorySlot('conversation.approval.card', {
            requestKey: approval.key,
            title,
            ...(approval.callId === undefined ? {} : { callId: approval.callId }),
            canAnswer: () => approval.answerable,
            onAllow: () => approval.answer('allowed-once'),
            onReject: () => approval.answer('rejected'),
          })
        }

        ctx.slots.inject('conversation.composer', () => ctx.slots.register({
          name: 'conversation.composer',
          id: 'dsh-approval-zh',
          priority: 0.5,
          select: (owner) => (owner && owner.pendingInteraction && owner.pendingInteraction.kind === 'approval'
            ? owner.pendingInteraction
            : null),
        }, ApprovalZhPanel))
      },
    }
    })(require)

    /* ========================= restart-button ========================= */
    // Verbatim from features/client/restart-button.raw.js (module preamble + factory body).
    const restartButton = (function (require) {
/**
 * dsh-restart-button — browser half.
 *
 * One control in the sidebar footer, drawn like the neighbouring footer actions
 * in this deployment: a full row with a visible label while the column is wide,
 * a centred 36px icon once it collapses to the rail.
 *
 *   click 1  arms the control for CONFIRM_MS
 *   click 2  asks the Host to restart the container, then watches the Host's
 *            per-process boot id and reloads this page when a new process
 *            answers. A restart may kill the reply of the very request that
 *            started it, so a failed POST alone is never reported as failure.
 */

    const React = require('react')
    const h = React.createElement

    const NS = 'restart-button'
    const STATUS_URL = '/api/dsh-restart/status'
    const RESTART_URL = '/api/dsh-restart/restart'
    const STYLE_TAG = 'dsh-restart-button/styles.css'
    const POLL_MS = 900
    const TIMEOUT_MS = 120000
    const CONFIRM_MS = 4000
    const ARM_GUARD_MS = 400

    // Metric-for-metric the same box as the sidebar's other footer rows (the
    // theme toggle in dsh-plugin-suite): 32px row, 12px radius, 14/22 type,
    // 9px inline padding, 6px icon gap, primary label colour. `flex: 1 1 100%`
    // keeps the row whole when the footer wraps, so its ink starts on the same
    // left inset as the rows above it instead of sharing a line with them.
    const CSS = [
      '.dsr-button{align-items:center;border:0;background:transparent;margin:0;cursor:pointer;display:inline-flex;',
      'font:inherit;overflow:hidden;-webkit-app-region:no-drag}',
      '.dsr-button[data-rail="true"]{width:36px;height:36px;padding:0;flex:none;justify-content:center;',
      'border-radius:var(--dsw-radius-md,12px);color:var(--dsw-alias-label-primary)}',
      '.dsr-button[data-rail="false"]{width:100%;flex:1 1 100%;height:32px;padding:0 9px;gap:6px;',
      'justify-content:flex-start;border-radius:var(--dsw-radius-md,12px);',
      'font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary)}',
      '@media (hover:hover){.dsr-button:hover{background-color:var(--dsw-alias-interactive-bg-hover)}}',
      '.dsr-button:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid ',
      'var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,var(--dsw-alias-label-primary)));outline-offset:-2px}',
      '.dsr-button[data-phase="confirm"]{color:var(--dsw-alias-state-warn-primary);',
      'background-color:var(--dsw-alias-interactive-bg-hover)}',
      '.dsr-button[data-phase="error"]{color:var(--dsw-alias-state-error-primary)}',
      '.dsr-button[data-phase="working"],.dsr-button[data-phase="waiting"]{cursor:progress}',
      '.dsr-button[data-phase="working"] svg,.dsr-button[data-phase="waiting"] svg{animation:dsr-spin 1s linear infinite}',
      '.dsr-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsr-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}',
      '@keyframes dsr-spin{to{transform:rotate(360deg)}}',
      '@keyframes dsr-pulse{50%{opacity:.35}}',
      '@media (prefers-reduced-motion:reduce){.dsr-button[data-phase="working"] svg,.dsr-button[data-phase="waiting"] svg{',
      'animation:dsr-pulse 1.6s ease-in-out infinite}}',
    ].join('')

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

    function RestartGlyph({ size }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true', focusable: 'false',
      },
        h('path', { d: 'M20 12a8 8 0 1 1-8-8c2.2 0 4.3.9 5.9 2.5L20 8.9' }),
        h('path', { d: 'M20 3.2v5.7h-5.7' }),
      )
    }

    function createButton(ctx) {
      const useT = () => {
        // LocaleSnapshot is { active, locales, revision }; the active id changes
        // on a language switch, which is what re-renders these labels.
        const [locale, setLocale] = React.useState(() => ctx.locale.getLocale().active)
        React.useEffect(() => ctx.locale.subscribe(() => setLocale(ctx.locale.getLocale().active)), [])
        return [ctx.locale.bind(NS), locale]
      }

      return function RestartButton(props) {
        const [t] = useT()
        const wide = Boolean(props && props.wide)
        const [phase, setPhase] = React.useState('idle')
        const [notice, setNotice] = React.useState('')
        const baseline = React.useRef(null)
        const armedAt = React.useRef(0)
        const confirmTimer = React.useRef(null)
        const alive = React.useRef(true)

        React.useEffect(() => () => {
          alive.current = false
          if (confirmTimer.current) clearTimeout(confirmTimer.current)
        }, [])

        React.useEffect(() => {
          let cancelled = false
          fetch(STATUS_URL, { cache: 'no-store' })
            .then((response) => (response.ok ? response.json() : null))
            .then((status) => {
              if (cancelled || !status || status.ok !== true) return
              if (typeof status.bootId === 'string') baseline.current = status.bootId
            })
            .catch(() => { /* the page can open while the Host is still booting */ })
          return () => { cancelled = true }
        }, [])

        const clearTimer = () => {
          if (confirmTimer.current) {
            clearTimeout(confirmTimer.current)
            confirmTimer.current = null
          }
        }

        const describeFailure = (payload, response) => {
          const code = payload && typeof payload.error === 'string' ? payload.error : ''
          if (code === 'already-restarting') return t('error.busy')
          if (code === 'cross-origin' || code === 'json-only') return t('error.refused')
          if (payload && typeof payload.message === 'string' && payload.message) {
            return `${t('error.failed')} — ${payload.message}`
          }
          return `${t('error.failed')} — HTTP ${response.status}`
        }

        const waitForNewBoot = async () => {
          const deadline = Date.now() + TIMEOUT_MS
          while (alive.current && Date.now() < deadline) {
            await sleep(POLL_MS)
            if (!alive.current) return
            try {
              const response = await fetch(STATUS_URL, { cache: 'no-store' })
              if (!response.ok) continue
              const status = await response.json()
              if (!status || status.ok !== true || typeof status.bootId !== 'string') continue
              if (baseline.current === null) {
                baseline.current = status.bootId
                continue
              }
              if (status.bootId !== baseline.current) {
                window.location.reload()
                return
              }
            } catch {
              // The container is down; keep waiting until it answers again.
            }
          }
          throw new Error(t('error.timeout'))
        }

        const restart = async () => {
          clearTimer()
          setNotice('')
          setPhase('working')
          let payload = null
          let failure = null
          try {
            const response = await fetch(RESTART_URL, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ confirm: true }),
            })
            payload = await response.json().catch(() => null)
            const accepted = response.ok && payload && payload.ok === true
            const alreadyRunning = response.status === 409 && payload && payload.error === 'already-restarting'
            if (!accepted && !alreadyRunning) failure = describeFailure(payload, response)
          } catch {
            // A dropped connection is expected: the restart may have killed the
            // Host before it finished the reply. The boot watch decides.
          }
          if (failure !== null) {
            setPhase('error')
            setNotice(failure)
            return
          }
          if (payload && typeof payload.bootId === 'string' && baseline.current === null) {
            baseline.current = payload.bootId
          }
          setPhase('waiting')
          try {
            await waitForNewBoot()
          } catch (error) {
            if (!alive.current) return
            setPhase('error')
            setNotice(error && error.message ? error.message : t('error.failed'))
          }
        }

        const armOrRestart = () => {
          if (phase === 'working' || phase === 'waiting') return
          if (phase === 'confirm') {
            // A double click must not discharge the confirmation by accident.
            if (Date.now() - armedAt.current < ARM_GUARD_MS) return
            void restart()
            return
          }
          clearTimer()
          setNotice('')
          setPhase('confirm')
          armedAt.current = Date.now()
          confirmTimer.current = setTimeout(() => {
            if (alive.current) setPhase('idle')
          }, CONFIRM_MS)
        }

        const busy = phase === 'working' || phase === 'waiting'
        const labelText = phase === 'confirm' ? t('action.confirm')
          : phase === 'waiting' ? t('action.waiting')
            : phase === 'error' ? t('action.error')
              : t('action')
        const hint = phase === 'waiting' ? t('hint.waiting')
          : phase === 'working' ? t('hint.working')
            : phase === 'error' ? (notice || t('error.failed'))
              : phase === 'confirm' ? t('hint.confirm')
                : t('hint.idle')

        return h('button', {
          type: 'button',
          className: 'dsr-button',
          'data-phase': phase,
          'data-rail': wide ? 'false' : 'true',
          'data-dsh-restart-button': 'true',
          title: hint,
          'aria-label': `${labelText} — ${hint}`,
          'aria-busy': busy ? 'true' : 'false',
          onClick: armOrRestart,
        },
          h(RestartGlyph, { size: 16 }),
          wide ? h('span', { className: 'dsr-label' }, labelText) : null,
          h('span', { className: 'dsr-sr', role: 'status', 'aria-live': 'polite' }, hint),
        )
      }
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => {
          const existing = document.querySelector(`style[data-plugin-css="${STYLE_TAG}"]`)
          if (existing) return () => existing.remove()
          const style = document.createElement('style')
          style.dataset.plugin = 'dsh-restart-button'
          style.dataset.pluginCss = STYLE_TAG
          style.textContent = CSS
          document.head.appendChild(style)
          return () => style.remove()
        }, 'dsh-restart-button: styles')

        ctx.effect(() => ctx.locale.register(NS, {
          en: {
            'action': 'Restart',
            'action.confirm': 'Confirm restart',
            'action.waiting': 'Restarting…',
            'action.error': 'Restart failed',
            'hint.idle': 'Restart the container this interface runs in',
            'hint.confirm': 'Click again to restart now — every session in this container is interrupted',
            'hint.working': 'Sending the restart request…',
            'hint.waiting': 'Restarting… this page reloads by itself when the container is back',
            'error.failed': 'Restart failed',
            'error.busy': 'A restart is already running',
            'error.refused': 'The request was refused',
            'error.timeout': 'The container did not come back in time',
          },
          zh: {
            'action': '重启',
            'action.confirm': '确认重启',
            'action.waiting': '正在重启…',
            'action.error': '重启失败',
            'hint.idle': '重启承载这个界面的容器',
            'hint.confirm': '再点一次立即重启——容器里的所有会话都会中断',
            'hint.working': '正在发送重启请求…',
            'hint.waiting': '正在重启…容器回来后本页自动刷新',
            'error.failed': '重启失败',
            'error.busy': '已经有重启在进行中',
            'error.refused': '请求被拒绝',
            'error.timeout': '等待容器恢复超时',
          },
        }), 'dsh-restart-button: dictionaries')

        const Button = createButton(ctx)
        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'dsh-restart-button',
          order: 30,
        }, Button))
      },
    }
    })(require)

    /* ========================= session-search ========================= */
    // Verbatim from features/client/session-search.raw.js (module preamble + factory body).
    const sessionSearch = (function (require) {
/**
 * Search inside the current Session — Client half.
 *
 * ONE seat: `conversation.session.header.utilities` — the right-aligned list of
 * Session utilities, where this button takes the leftmost cell of that row
 * (order -100, before the shipped schedule control at -5). The
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
        // The composer lives inside the Chat region (`data-composer-seat` is marked
        // `data-conversation-region="composer"`), so it must be excluded here or
        // the placeholder, the draft text and control labels would all match.
        if (parent !== null && text.length > 0
          && parent.closest('[aria-hidden="true"],[hidden],[data-conversation-region="composer"]') === null) {
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

        // Focus the field as soon as the panel exists: on the render that sets
        // `open` the portal target is still null, so the field is not mounted
        // yet — depending on `host` too is what turns "click, then click the
        // input" into "click and type".
        React.useEffect(() => {
          if (!open || host === null) return undefined
          const input = inputRef.current
          if (input === null || typeof input.focus !== 'function') return undefined
          input.focus()
          if (typeof input.select === 'function') input.select()
          return undefined
        }, [open, host])

        // Close when the pointer lands outside the panel or the button.
        React.useEffect(() => {
          if (!open) return undefined
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
          order: -100,
        }, createSearch(t)))
      },
    }
    })(require)

    /** The switchable features, in settings-page order. */
    const FEATURES = [
      { id: "artifact-copy", plugin: artifactCopy },
      { id: "theme-toggle", plugin: themeToggle },
      { id: "turn-credits", plugin: turnCredits },
      { id: "hide-branch", plugin: hideBranch },
      { id: "sidebar-pins", plugin: sidebarPins },
      { id: "rightbar-default-open", plugin: rightbarDefaultOpen },
      { id: "archive-filter-toggle", plugin: archiveFilterToggle },
      { id: "approval-zh", plugin: approvalZh },
      { id: "restart-button", plugin: restartButton },
      { id: "session-search", plugin: sessionSearch },
    ]

    /** Dictionaries, flattened to the dotted keys `t()` looks up. */
    const DICTIONARIES = {
      zh: {
            "settings.title": "小插件",
            "settings.nav": "小插件",
            "settings.subtitle": "管理套件里的十个独立功能，开关即时生效。",
            "settings.enableAll": "全部开启",
            "settings.disableAll": "全部关闭",
            "settings.saved": "配置保存在",
            "settings.loadFailed": "读取配置失败，显示的是上次缓存的开关状态。",
            "settings.saveFailed": "保存失败，开关已回退。",
            "settings.busy": "正在应用…",
            "settings.features.artifact-copy.title": "文件右键复制",
            "settings.features.artifact-copy.description": "在对话里的文件上右键，复制路径、相对路径、文件内容或文件本体。",
            "settings.features.theme-toggle.title": "深浅色切换",
            "settings.features.theme-toggle.description": "侧栏底部一个按钮切换明暗主题，浏览器与桌面客户端一致。主题偏好写在共享的 profile 补丁里，偶尔会被别的插件覆盖回去；按钮会在点击后的几秒内自动重试，把你要的那一档再写回去。",
            "settings.features.turn-credits.title": "每轮花费",
            "settings.features.turn-credits.description": "在每条回复的操作行显示这一轮实际花掉的积分或人民币。",
            "settings.features.hide-branch.title": "隐藏「分支到新会话」",
            "settings.features.hide-branch.description": "去掉助手消息上那个分支按钮。",
            "settings.features.sidebar-pins.title": "记住取消固定的面板",
            "settings.features.sidebar-pins.description": "重启后仍然保持你取消固定的侧栏面板。",
            "settings.features.rightbar-default-open.title": "右侧栏默认展开",
            "settings.features.rightbar-default-open.description": "会话出现时自动展开右栏；窄于 768px 不展开，避免遮住对话。",
            "settings.features.archive-filter-toggle.title": "归档筛选一键切换",
            "settings.features.archive-filter-toggle.description": "在侧栏「工作区」标题行的搜索图标左侧加一个按钮，一键在「隐藏已归档」和「仅显示已归档」之间切换；图标随状态变化，切换后弹一句提示。",
            "settings.features.approval-zh.title": "审批界面中文",
            "settings.features.approval-zh.description": "把审批卡标题显示成中文：DSH 自带的越权升级与 auto-review 措辞走离线词典，剩余英文经内置翻译服务处理，工具名、路径、JSON、命令与沙箱模式保留原文。跟随界面语言，翻译失败时显示原文，不影响审批决策。",
            "settings.features.restart-button.title": "重启按钮",
            "settings.features.restart-button.description": "侧栏底部一个重启按钮：点第一下待确认，点第二下结束 Host 进程，由容器重启策略把 DSH 拉回来，页面自动刷新。容器里所有会话都会中断。",
            "settings.features.session-search.title": "会话内搜索",
            "settings.features.session-search.description": "在会话标题栏右侧那一排图标的最左边加一个搜索按钮（Ctrl/⌘+F 也能打开），输入关键字后高亮当前会话里所有匹配并逐个跳转，Enter 下一个、Shift+Enter 上一个。只搜索已经加载进页面的对话内容。"},
      en: {
            "settings.title": "Plugin suite",
            "settings.nav": "Plugin suite",
            "settings.subtitle": "Manage the ten independent features. Changes apply immediately.",
            "settings.enableAll": "Enable all",
            "settings.disableAll": "Disable all",
            "settings.saved": "Configuration saved in",
            "settings.loadFailed": "Could not read the configuration; showing the last cached switch state.",
            "settings.saveFailed": "Save failed; the switch was reverted.",
            "settings.busy": "Applying…",
            "settings.features.artifact-copy.title": "File right-click copy",
            "settings.features.artifact-copy.description": "Right-click a file in the conversation to copy its path, relative path, contents, or the file itself.",
            "settings.features.theme-toggle.title": "Theme toggle",
            "settings.features.theme-toggle.description": "One button at the bottom of the sidebar switches light and dark, on both the browser and the desktop client. The preference lives in the shared profile patch, which other plugins occasionally overwrite; the button retries for a few seconds after a click to put your choice back.",
            "settings.features.turn-credits.title": "Per-turn spend",
            "settings.features.turn-credits.description": "Shows what each completed turn cost, in credits or CNY, on that reply's action row.",
            "settings.features.hide-branch.title": "Hide \"branch into a new conversation\"",
            "settings.features.hide-branch.description": "Removes the branch button from assistant messages.",
            "settings.features.sidebar-pins.title": "Remember unpinned panels",
            "settings.features.sidebar-pins.description": "Keeps the sidebar panels you unpinned unpinned after a restart.",
            "settings.features.rightbar-default-open.title": "Right sidebar open by default",
            "settings.features.rightbar-default-open.description": "Expands the right column when a session appears; left alone under 768px so it never covers the conversation.",
            "settings.features.archive-filter-toggle.title": "One-click archive filter",
            "settings.features.archive-filter-toggle.description": "Adds a button left of the search icon in the sidebar's Workspace header: one click flips between \"hide archived\" and \"archived only\". The glyph follows the state and a short notice confirms the switch.",
            "settings.features.approval-zh.title": "Chinese approval cards",
            "settings.features.approval-zh.description": "Shows the approval card headline in Chinese: DSH's own escalation and auto-review wording comes from an offline dictionary, leftover English prose goes through the built-in translator, and tool names, paths, JSON, commands and sandbox modes stay verbatim. Follows the UI language; a failed translation keeps the original text and never changes a decision.",
            "settings.features.restart-button.title": "Restart button",
            "settings.features.restart-button.description": "One control at the bottom of the sidebar: the first click arms it, the second ends the Host process and the container restart policy brings DSH back; the page reloads itself. Every session in this container is interrupted.",
            "settings.features.session-search.title": "In-session search",
            "settings.features.session-search.description": "Adds a search button at the left end of the header's icon row (Ctrl/⌘+F also opens it): it highlights every match in the current session and steps through them, Enter for next and Shift+Enter for previous. Only the conversation already loaded in the page is searched."},
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
