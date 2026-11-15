/**
 * dsh-sync-panel — 设置页里的「同步与迁移」一页（Client 半）。
 *
 * 两个按钮：打包（生成 zip）、还原（用选中的 zip 覆盖本机插件与配置）。
 * 所有动作都由 Host 半执行，这里只发 HTTP 请求、显示进度和日志。
 */
window.__ModuleLoader__.load({
  id: '@yggizz/dsh-sync-panel',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const SLOT = 'settings.section'
    const ENTRY_ID = 'dsh-sync'
    const BASE = '/dsh-sync'

    const DICT = {
      zh: {
        section: '同步与迁移',
        intro: '把本地插件与 DSH 配置打成一个 zip，传到另一台电脑后一键还原（自动改写 link 路径并装依赖）。',
        saveLabel: '打包（本机 → zip）',
        restoreLabel: '还原（zip → 本机）',
        includePresets: '连 .agent-presets 一起打包',
        installDeps: '还原后自动 pnpm install',
        packBtn: '开始打包',
        restoreBtn: '开始还原',
        refresh: '刷新',
        packing: '打包中…',
        restoring: '还原中…',
        pickZip: '选择一个 zip',
        noZip: '还没有 zip，先打包一次。',
        profileDir: 'profile 目录',
        syncDir: '打包目录',
        pluginsRoot: '插件落点',
        recent: '现成包',
        log: '执行日志',
        restartHint: '还原完成：请重启 DSH 才会加载新插件与配置。',
        packDone: '打包完成',
        failed: '失败',
        empty: '（暂无）',
      },
      en: {
        section: 'Sync & migrate',
        intro: 'Bundle local plugins and DSH config into one zip, then restore it on another PC (link paths rewritten, deps reinstalled).',
        saveLabel: 'Pack (this PC → zip)',
        restoreLabel: 'Restore (zip → this PC)',
        includePresets: 'Include .agent-presets',
        installDeps: 'Run pnpm install after restore',
        packBtn: 'Pack now',
        restoreBtn: 'Restore now',
        refresh: 'Refresh',
        packing: 'Packing…',
        restoring: 'Restoring…',
        pickZip: 'Pick a zip',
        noZip: 'No zip yet — pack one first.',
        profileDir: 'Profile dir',
        syncDir: 'Output dir',
        pluginsRoot: 'Plugins land here',
        recent: 'Existing packages',
        log: 'Log',
        restartHint: 'Restore finished: restart DSH to load the new plugins and config.',
        packDone: 'Packed',
        failed: 'Failed',
        empty: '(none)',
      },
    }

    const CSS = [
      '.dsp-wrap{display:flex;flex-direction:column;gap:14px;font-size:13px;color:var(--dsw-alias-label-primary);}',
      '.dsp-intro{color:var(--dsw-alias-label-secondary);line-height:1.65;margin:0;}',
      '.dsp-card{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:14px;background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:10px;}',
      '.dsp-card h4{margin:0;font-size:13px;font-weight:600;}',
      '.dsp-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}',
      '.dsp-meta{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.7;word-break:break-all;}',
      '.dsp-meta code{font-size:11.5px;}',
      '.dsp-btn{appearance:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 14px;font:inherit;cursor:pointer;}',
      '.dsp-btn:hover:not(:disabled){border-color:var(--dsw-alias-border-l4);color:var(--dsw-alias-label-primary);}',
      '.dsp-btn:disabled{opacity:.55;cursor:default;}',
      // 主按钮用 button-primary 语义 token：深色模式下 brand-primary 是近白色，
      // 配白色文字会变成白底白字；button-primary-fill 与 label-primary-foreground 成对翻转。
      '.dsp-btn-primary{background:var(--dsw-alias-button-primary-fill);border-color:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);}',
      '.dsp-btn-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover);border-color:var(--dsw-alias-button-primary-hover);color:var(--dsw-alias-label-primary-foreground);}',
      '.dsp-label{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer;}',
      '.dsp-select{max-width:100%;padding:5px 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;}',
      '.dsp-ok{color:var(--dsw-alias-state-success-primary);}',
      '.dsp-err{color:var(--dsw-alias-state-error-primary);}',
      '.dsp-warn{color:var(--dsw-alias-state-warn-primary);}',
      '.dsp-log{margin:0;max-height:220px;overflow:auto;white-space:pre-wrap;word-break:break-all;font-size:11.5px;line-height:1.6;',
      'background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:10px;color:var(--dsw-alias-label-secondary);}',
    ].join('')

    function dictOf(ctx) {
      let active = ''
      try {
        const snapshot = ctx.locale.getSnapshot()
        active = snapshot && snapshot.active ? String(snapshot.active) : ''
      } catch {
        active = ''
      }
      return DICT[active.toLowerCase().startsWith('zh') ? 'zh' : 'en'] ?? DICT.en
    }

    async function request(path, body) {
      const response = await fetch(BASE + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const data = await response.json().catch(() => ({ ok: false, message: '返回内容不是 JSON' }))
      return data
    }

    function SyncPanel(props) {
      const t = props.t
      const [status, setStatus] = React.useState(null)
      const [busy, setBusy] = React.useState('')
      const [message, setMessage] = React.useState(null)
      const [logText, setLogText] = React.useState('')
      const [includePresets, setIncludePresets] = React.useState(false)
      const [installDeps, setInstallDeps] = React.useState(true)
      const [zip, setZip] = React.useState('')

      const reload = React.useCallback(async () => {
        const data = await request('/status', {})
        if (data.ok !== true) {
          setMessage({ kind: 'err', text: data.message ?? t.failed })
          return
        }
        setStatus(data)
        if (data.includePresets === true) setIncludePresets(true)
        if (data.installDeps === false) setInstallDeps(false)
        setZip(current => {
          if (current !== '' && data.archives.some(item => item.path === current)) return current
          return data.archives.length > 0 ? data.archives[0].path : ''
        })
      }, [t])

      React.useEffect(() => {
        reload()
      }, [reload])

      const run = async (kind) => {
        if (busy !== '') return
        setBusy(kind === 'pack' ? t.packing : t.restoring)
        setMessage(null)
        setLogText('')
        try {
          const data = kind === 'pack'
            ? await request('/pack', { includePresets })
            : await request('/restore', { zip, installDeps })
          if (typeof data.log === 'string') setLogText(data.log)
          if (data.ok === true) {
            setMessage({
              kind: kind === 'restore' ? 'warn' : 'ok',
              text: kind === 'restore' ? t.restartHint : `${t.packDone}：${data.zip ?? ''}`,
            })
          } else {
            setMessage({ kind: 'err', text: data.message ?? t.failed })
          }
          await reload()
        } catch (error) {
          setMessage({ kind: 'err', text: String(error?.message ?? error) })
        } finally {
          setBusy('')
        }
      }

      const archives = status?.archives ?? []
      const meta = [
        [t.profileDir, status?.profileDir],
        [t.syncDir, status?.syncDir],
        [t.pluginsRoot, status?.pluginsRoot],
      ].filter(([, value]) => typeof value === 'string' && value !== '')

      return h(
        'div',
        { className: 'dsp-wrap' },
        h('p', { className: 'dsp-intro' }, t.intro),

        h(
          'div',
          { className: 'dsp-card' },
          h('h4', {}, t.saveLabel),
          h(
            'label',
            { className: 'dsp-label' },
            h('input', {
              type: 'checkbox',
              checked: includePresets,
              onChange: event => setIncludePresets(event.target.checked),
            }),
            t.includePresets,
          ),
          h(
            'div',
            { className: 'dsp-row' },
            h(
              'button',
              {
                type: 'button',
                className: 'dsp-btn dsp-btn-primary',
                disabled: busy !== '',
                onClick: () => run('pack'),
              },
              busy === t.packing ? t.packing : t.packBtn,
            ),
            h('button', { type: 'button', className: 'dsp-btn', disabled: busy !== '', onClick: reload }, t.refresh),
          ),
        ),

        h(
          'div',
          { className: 'dsp-card' },
          h('h4', {}, t.restoreLabel),
          archives.length === 0
            ? h('div', { className: 'dsp-meta' }, t.noZip)
            : h(
                'div',
                { className: 'dsp-row' },
                h(
                  'select',
                  {
                    className: 'dsp-select',
                    value: zip,
                    onChange: event => setZip(event.target.value),
                  },
                  archives.map(item =>
                    h('option', { key: item.path, value: item.path }, `${item.name}（${item.sizeMB} MB）`),
                  ),
                ),
              ),
          h(
            'label',
            { className: 'dsp-label' },
            h('input', {
              type: 'checkbox',
              checked: installDeps,
              onChange: event => setInstallDeps(event.target.checked),
            }),
            t.installDeps,
          ),
          h(
            'div',
            { className: 'dsp-row' },
            h(
              'button',
              {
                type: 'button',
                className: 'dsp-btn',
                disabled: busy !== '' || zip === '',
                onClick: () => run('restore'),
              },
              busy === t.restoring ? t.restoring : t.restoreBtn,
            ),
          ),
        ),

        message === null
          ? null
          : h('div', { className: `dsp-${message.kind}` }, message.text),

        meta.length === 0
          ? null
          : h(
              'div',
              { className: 'dsp-meta' },
              meta.map(([label, value]) =>
                h('div', { key: label }, `${label}：`, h('code', {}, value)),
              ),
            ),

        logText === ''
          ? null
          : h(
              'div',
              { className: 'dsp-card' },
              h('h4', {}, t.log),
              h('pre', { className: 'dsp-log' }, logText),
            ),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const t = dictOf(ctx)

        ctx.effect(() => {
          const style = document.createElement('style')
          style.setAttribute('data-plugin', 'dsh-sync-panel')
          style.textContent = CSS
          document.head.appendChild(style)
          return () => {
            style.remove()
          }
        }, 'dsh-sync-panel: styles')

        ctx.effect(() =>
          ctx.slots.inject(SLOT, () =>
            ctx.slots.register(
              { name: SLOT, id: ENTRY_ID, order: 70, label: () => t.section },
              props => h(SyncPanel, { t, close: props.close }),
            ),
          ),
        )
      },
    }
  },
})
