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
window.__ModuleLoader__.load({
  id: 'dsh-approval-zh',
  factory(require) {
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
  },
})
