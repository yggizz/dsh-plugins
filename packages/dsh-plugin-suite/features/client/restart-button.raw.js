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
window.__ModuleLoader__.load({
  id: 'dsh-restart-button',
  factory(require) {
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
  },
})
