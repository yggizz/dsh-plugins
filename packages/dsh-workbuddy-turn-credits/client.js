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

window.__ModuleLoader__.load({
  id: '@yggizz/dsh-workbuddy-turn-credits',
  factory(require) {
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
  },
})
