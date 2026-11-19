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
window.__ModuleLoader__.load({
  id: '@local/rightbar-default-open',
  factory() {
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
  },
});
