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
window.__ModuleLoader__.load({
  id: '@local/rightbar-default-open',
  factory() {
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
  },
});
