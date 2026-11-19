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

window.__ModuleLoader__.load({
  id: '@local/dsh-artifact-copy',
  factory(require) {
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
  },
})
