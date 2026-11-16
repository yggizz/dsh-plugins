/**
 * dsh-sync-panel — 设置页里的「同步与迁移」一页（Client 半）。
 *
 * 打包：勾选要带走的类别（本地插件 / 市场插件 / 插件配置 / DSH 配置 / 插件开关 / 预设）。
 * 还原：选 zip、勾选只应用哪些类别、可选自动 pnpm install。
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
        intro: '把本地插件与 DSH 配置打成一个 zip，传到另一台电脑后一键还原（自动改写 link 路径并装依赖）。下面可以只挑需要的部分。',
        packTitle: '打包（本机 → zip）',
        restoreTitle: '还原（zip → 本机）',
        choose: '要带走的内容',
        selectAll: '全选',
        selectNone: '全不选',
        categories: {
          'local-plugins': ['本地插件', 'profile 里 link: 指向的插件源码（@local/* 等）'],
          'market-plugins': ['插件市场插件', 'package.json + pnpm-lock.yaml，靠目标机重装'],
          'plugin-configs': ['插件配置', '各插件自己的参数（config 段），开关保持本机值'],
          'dsh-config': ['DSH 配置', '整份 cordis.patch.yml，含模型、UI、插件开关与参数'],
          'plugin-switches': ['插件开关', '只带每条目的 disabled，不动其它配置'],
          presets: ['Agent 预设', '.agent-presets 里的自定义预设'],
        },
        packBtn: '开始打包',
        restoreBtn: '开始还原',
        refresh: '刷新',
        packing: '打包中…',
        restoring: '还原中…',
        noZip: '还没有 zip，先打包一次。',
        applyOnly: '只应用下列类别（不勾则按包内全部内容）',
        installDeps: '还原后自动 pnpm install',
        profileDir: 'profile 目录',
        syncDir: '打包目录',
        pluginsRoot: '插件落点',
        defaultSet: '默认勾选',
        log: '执行日志',
        restartHint: '还原完成：请重启 DSH 才会加载新插件与配置。',
        packDone: '打包完成',
        failed: '失败',
        busyHint: '正在执行',
      },
      en: {
        section: 'Sync & migrate',
        intro: 'Bundle local plugins and DSH config into one zip, then restore it on another PC (link paths rewritten, deps reinstalled). Pick only what you need below.',
        packTitle: 'Pack (this PC → zip)',
        restoreTitle: 'Restore (zip → this PC)',
        choose: 'What to include',
        selectAll: 'All',
        selectNone: 'None',
        categories: {
          'local-plugins': ['Local plugins', 'Plugin source behind link: entries'],
          'market-plugins': ['Market plugins', 'package.json + lockfile, reinstalled on target'],
          'plugin-configs': ['Plugin configs', 'Per-plugin config blocks only, switches stay local'],
          'dsh-config': ['DSH config', 'Full cordis.patch.yml incl. models, UI, switches'],
          'plugin-switches': ['Plugin switches', 'Only each entry\'s disabled flag'],
          presets: ['Agent presets', 'Custom presets under .agent-presets'],
        },
        packBtn: 'Pack now',
        restoreBtn: 'Restore now',
        refresh: 'Refresh',
        packing: 'Packing…',
        restoring: 'Restoring…',
        noZip: 'No zip yet — pack one first.',
        applyOnly: 'Apply only these (empty = whatever the zip has)',
        installDeps: 'Run pnpm install after restore',
        profileDir: 'Profile dir',
        syncDir: 'Output dir',
        pluginsRoot: 'Plugins land here',
        defaultSet: 'Defaults',
        log: 'Log',
        restartHint: 'Restore finished: restart DSH to load the new plugins and config.',
        packDone: 'Packed',
        failed: 'Failed',
        busyHint: 'Running',
      },
    }

    const ALL_IDS = [
      'local-plugins',
      'market-plugins',
      'plugin-configs',
      'dsh-config',
      'plugin-switches',
      'presets',
    ]

    const CSS = [
      '.dsp-wrap{display:flex;flex-direction:column;gap:14px;font-size:13px;color:var(--dsw-alias-label-primary);}',
      '.dsp-intro{color:var(--dsw-alias-label-secondary);line-height:1.65;margin:0;}',
      '.dsp-card{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:14px;background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:10px;}',
      '.dsp-card h4{margin:0;font-size:13px;font-weight:600;}',
      '.dsp-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}',
      '.dsp-meta{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.7;word-break:break-all;}',
      '.dsp-meta code{font-size:11.5px;}',
      '.dsp-btn{appearance:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 14px;font:inherit;cursor:pointer;}',
      '.dsp-btn:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);}',
      '.dsp-btn:disabled{opacity:.55;cursor:default;}',
      '.dsp-btn-primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff;}',
      '.dsp-btn-primary:hover:not(:disabled){color:#fff;filter:brightness(1.06);}',
      '.dsp-btn-sm{padding:3px 10px;font-size:12px;}',
      '.dsp-label{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer;}',
      '.dsp-groups{display:flex;flex-direction:column;gap:8px;}',
      '.dsp-group{display:flex;align-items:flex-start;gap:8px;padding:7px 9px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);}',
      '.dsp-group input[type=checkbox]{margin-top:3px;}',
      '.dsp-group-main{display:flex;flex-direction:column;gap:2px;}',
      '.dsp-group-name{font-size:12.5px;}',
      '.dsp-group-hint{color:var(--dsw-alias-label-secondary);font-size:11.5px;line-height:1.5;}',
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

    /** 一组复选框。 */
    function CategoryPicker(props) {
      const { ids, t, selected, onToggle } = props
      return h(
        'div',
        { className: 'dsp-groups' },
        ids.map(id => {
          const entry = t.categories[id] ?? [id, '']
          const checked = selected.includes(id)
          return h(
            'label',
            { key: id, className: 'dsp-group' },
            h('input', {
              type: 'checkbox',
              checked,
              onChange: () => onToggle(id),
            }),
            h(
              'span',
              { className: 'dsp-group-main' },
              h('span', { className: 'dsp-group-name' }, entry[0]),
              entry[1] === '' ? null : h('span', { className: 'dsp-group-hint' }, entry[1]),
            ),
          )
        }),
      )
    }

    function SyncPanel(props) {
      const t = props.t
      const [status, setStatus] = React.useState(null)
      const [busy, setBusy] = React.useState('')
      const [message, setMessage] = React.useState(null)
      const [logText, setLogText] = React.useState('')
      const [include, setInclude] = React.useState([])
      const [apply, setApply] = React.useState([])
      const [installDeps, setInstallDeps] = React.useState(true)
      const [zip, setZip] = React.useState('')

      const reload = React.useCallback(async () => {
        const data = await request('/status', {})
        if (data.ok !== true) {
          setMessage({ kind: 'err', text: data.message ?? t.failed })
          return
        }
        setStatus(data)
        setInclude(current => (current.length === 0 ? (data.include ?? []) : current))
        if (data.installDeps === false) setInstallDeps(false)
        setZip(current => {
          if (current !== '' && data.archives.some(item => item.path === current)) return current
          return data.archives.length > 0 ? data.archives[0].path : ''
        })
      }, [t])

      React.useEffect(() => {
        reload()
      }, [reload])

      const toggle = (setter) => (id) => {
        setter(current => (current.includes(id) ? current.filter(item => item !== id) : [...current, id]))
      }

      const run = async (kind) => {
        if (busy !== '') return
        setBusy(kind === 'pack' ? t.packing : t.restoring)
        setMessage(null)
        setLogText('')
        try {
          const data = kind === 'pack'
            ? await request('/pack', { include })
            : await request('/restore', { zip, installDeps, apply })
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
      const disabled = busy !== ''
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
          h('h4', {}, t.packTitle),
          h(
            'div',
            { className: 'dsp-row' },
            h('span', { className: 'dsp-meta' }, t.choose),
            h(
              'button',
              { type: 'button', className: 'dsp-btn dsp-btn-sm', disabled, onClick: () => setInclude([...ALL_IDS]) },
              t.selectAll,
            ),
            h(
              'button',
              { type: 'button', className: 'dsp-btn dsp-btn-sm', disabled, onClick: () => setInclude([]) },
              t.selectNone,
            ),
          ),
          h(CategoryPicker, { ids: ALL_IDS, t, selected: include, onToggle: toggle(setInclude) }),
          h(
            'div',
            { className: 'dsp-row' },
            h(
              'button',
              {
                type: 'button',
                className: 'dsp-btn dsp-btn-primary',
                disabled: disabled || include.length === 0,
                onClick: () => run('pack'),
              },
              busy === t.packing ? t.packing : t.packBtn,
            ),
            h('button', { type: 'button', className: 'dsp-btn', disabled, onClick: reload }, t.refresh),
          ),
        ),

        h(
          'div',
          { className: 'dsp-card' },
          h('h4', {}, t.restoreTitle),
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
                    disabled,
                    onChange: event => setZip(event.target.value),
                  },
                  archives.map(item =>
                    h('option', { key: item.path, value: item.path }, `${item.name}（${item.sizeMB} MB）`),
                  ),
                ),
              ),
          h(
            'div',
            { className: 'dsp-row' },
            h('span', { className: 'dsp-meta' }, t.applyOnly),
            h(
              'button',
              { type: 'button', className: 'dsp-btn dsp-btn-sm', disabled, onClick: () => setApply([]) },
              t.selectNone,
            ),
          ),
          h(CategoryPicker, { ids: ALL_IDS, t, selected: apply, onToggle: toggle(setApply) }),
          h(
            'label',
            { className: 'dsp-label' },
            h('input', {
              type: 'checkbox',
              checked: installDeps,
              disabled,
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
                disabled: disabled || zip === '',
                onClick: () => run('restore'),
              },
              busy === t.restoring ? t.restoring : t.restoreBtn,
            ),
          ),
        ),

        message === null ? null : h('div', { className: `dsp-${message.kind}` }, message.text),

        meta.length === 0
          ? null
          : h(
              'div',
              { className: 'dsp-meta' },
              meta.map(([label, value]) => h('div', { key: label }, `${label}：`, h('code', {}, value))),
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
