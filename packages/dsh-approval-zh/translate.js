/**
 * Chinese rendering of one approval card's headline.
 *
 * Three layers, in order:
 *
 *   1. template  DSH's own escalation/denial sentences are recognised and
 *                rewritten with a fixed Chinese frame; only the trailing prose
 *                is handed to the later layers.
 *   2. dictionary exact matches for DSH boilerplate, so the common cards are
 *                translated with no network request and no wording drift.
 *   3. machine   any fragment that still carries English (and no Chinese) goes
 *                through the Host `translator` service (anonymous endpoint by
 *                default).
 *
 * Before layers 2-3 run, every identifier-like token is replaced by a
 * placeholder: fenced/inline code, JSON blobs, URLs, file paths, CLI flags,
 * snake_case names, kebab-case values (sandbox modes) and file names with a
 * known extension. The placeholders are restored verbatim afterwards, so
 * `danger-full-access`, `plugin_manager`, `/home/node/.dsh` and quoted JSON
 * never reach the translator. A translator may reflow `<0>` at a sentence end,
 * so a second pass with private-use markers runs instead; if both fail the
 * fragment keeps its original text rather than showing corrupted copy.
 */

/** Fixed Chinese frames for the sentences DSH itself emits. */
const TEMPLATES = [
  {
    // @deepseek-ai/dsh-sandbox zh template, already partly Chinese.
    test: (text) => /^允许本次操作使用\s*(.+?)\s*权限[：:]\s*([\s\S]*)$/.exec(text),
    build: (match) => ({ head: `允许本次操作使用 ${match[1]} 权限：`, tail: match[2] }),
  },
  {
    // The same sentence from the English dictionary.
    test: (text) => /^Allow this operation with\s+(.+?)\s+permissions?\s*[:：]\s*([\s\S]*)$/i.exec(text),
    build: (match) => ({ head: `允许本次操作使用 ${match[1]} 权限：`, tail: match[2] }),
  },
  {
    // Audit-style fallback used when a requester supplies only `reason`.
    test: (text) => /^escalate sandbox to\s+(.+?)\s*[:：]\s*([\s\S]*)$/i.exec(text),
    build: (match) => ({ head: `请求将沙箱提升到 ${match[1]} 权限：`, tail: match[2] }),
  },
  {
    // @deepseek-ai/dsh-experimental-auto-review display copy.
    test: (text) => /^Auto review denied (?:tool "([^"]+)"|this call)\s*(?:[:：]\s*([\s\S]*))?$/i.exec(text),
    build: (match) => ({
      head: match[1] === undefined ? 'Auto review 拒绝了此调用。' : `Auto review 拒绝了工具「${match[1]}」`,
      tail: match[2] ?? '',
      separator: match[2] === undefined ? '' : '：',
    }),
  },
]

/** Exact sentences translated without a network round trip. Key = normalised text. */
const DICTIONARY = new Map([
  [
    'profile changes persist across sessions; installed host code runs outside the workspace sandbox',
    '配置变更会跨会话持续生效；安装的 Host 代码在工作区沙箱之外运行。',
  ],
  [
    'profile changes persist across sessions.',
    '配置变更会跨会话持续生效。',
  ],
  [
    'profile changes persist across sessions',
    '配置变更会跨会话持续生效；',
  ],
  [
    'installed host code runs outside the workspace sandbox',
    '安装的 Host 代码在工作区沙箱之外运行。',
  ],
  [
    'approval prompts are disabled in this session: actions that require approval are rejected automatically — do not request sandbox escalation (do not set `sandbox_permissions`).',
    '本次会话已关闭审批提示：需要审批的操作会被自动拒绝——不要再请求沙箱升级（不要设置 `sandbox_permissions`）。',
  ],
  [
    'auto review denied this call.',
    'Auto review 拒绝了此调用。',
  ],
])

/** Tokens replaced before translation and restored afterwards. */
const SHIELD_RULES = [
  /```[\s\S]*?```/g,
  /`[^`\n]+`/g,
  /\{[^\n]*?\}|\[[^\]\n]*?\]/g,
  /\bhttps?:\/\/[^\s，。；、）)】"'<>]+/g,
  /(?:[A-Za-z]:\\|\/|~\/)[^\s，。；：、"'）)\]】]+/g,
  /\b[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+\b/g,
  /\b[A-Za-z0-9_.-]+\.(?:json|ya?ml|js|mjs|cjs|tsx?|md|txt|db|sh|py|svg|css|html|toml|ini|conf|lock)\b/g,
  /(?<![\w-])--?[A-Za-z][\w-]*(?![\w-])/g,
  /\b[a-z][a-z0-9]*(?:-[a-z0-9]+)+\b/g,
]

/** Placeholder dialects: brackets first, invisible markers as the retry. */
const STYLES = [
  { hold: (index) => `<${index}>`, pattern: /<(\d+)>/g },
  { hold: (index) => `\uE000${index}\uE001`, pattern: /\uE000(\d+)\uE001/g },
]

const HAS_ENGLISH = /[A-Za-z]{2,}/
const HAS_CJK = /[\u3400-\u9fff]/
const MAX_FRAGMENTS = 24

function normalise(text) {
  return text
    .trim()
    .replace(/^[\s"'`「『(（]+|[\s"'`」』)）]+$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[.;；。！？]+$/g, '')
    .toLowerCase()
}

function hasEnglish(text) {
  return HAS_ENGLISH.test(text)
}

/** Replace identifier-like tokens with placeholders of one style. */
function shield(text, style) {
  const store = []
  let out = String(text)
  for (const rule of SHIELD_RULES) {
    out = out.replace(rule, (value) => style.hold(store.push(value) - 1))
  }
  return { out, store }
}

/** Restore placeholders; `null` when one is missing, out of range or mangled. */
function unshield(text, store, style) {
  let restored = 0
  let broken = false
  const out = text.replace(style.pattern, (whole, index) => {
    const value = store[Number(index)]
    if (value === undefined) {
      broken = true
      return whole
    }
    restored += 1
    return value
  })
  // Every shielded token must come back exactly once: a translator that
  // silently drops or duplicates a marker yields unusable copy.
  if (restored !== store.length) broken = true
  // A translator may space out or reflow an ASCII marker; the sentence is then
  // unusable, so the caller keeps the original wording.
  if (broken || /<\s*\d+\s*>/.test(out) || /[\uE000\uE001]/.test(out)) return null
  return out
}

/** Split after sentence terminators while keeping the delimiter. */
function fragmentsOf(text) {
  return text.split(/(?<=[。！？\n])|(?<=[.!?;])\s+/)
}

/**
 * One full translation pass with a single placeholder dialect.
 * @param text - prose without any fixed DSH frame.
 * @param machine - machine-translation function, or null when disabled.
 * @param style - placeholder dialect for this pass.
 * @returns translated prose, whether it changed, and whether restoration worked.
 */
async function translatePass(text, machine, style) {
  const { out: shielded, store } = shield(text, style)
  const parts = fragmentsOf(shielded)
  if (parts.length > MAX_FRAGMENTS) return { text, changed: false, ok: false }
  const jobs = []
  const results = parts.map((part, index) => {
    if (!hasEnglish(part)) return part
    const hit = DICTIONARY.get(normalise(part))
    if (hit !== undefined) return hit
    // Sentences that already read as Chinese keep their wording; only fully
    // foreign fragments are worth sending out.
    if (HAS_CJK.test(part)) return part
    jobs.push(index)
    return null
  })
  if (jobs.length > 0 && machine !== null) {
    const lines = await machine(jobs.map((index) => parts[index]).join('\n'))
    const translated = String(lines).split('\n')
    if (translated.length === jobs.length && translated.every((line) => line.trim() !== '')) {
      jobs.forEach((index, order) => { results[index] = translated[order] })
    }
  }
  const merged = results.map((value, index) => (value === null ? parts[index] : value)).join('')
  const restored = unshield(merged, store, style)
  if (restored === null) return { text, changed: false, ok: false }
  return { text: restored, changed: restored !== text, ok: true }
}

/**
 * Translate the English fragments only, then restore the shielded tokens.
 * @param text - headline prose.
 * @param machine - machine-translation function, or null when disabled.
 * @returns translated prose and whether anything changed.
 */
async function translateProse(text, machines) {
  if (!hasEnglish(text)) return { text, changed: false }
  for (const style of STYLES) {
    for (const machine of machines) {
      const pass = await translatePass(text, machine, style)
      if (pass.ok) return { text: pass.text, changed: pass.changed }
    }
  }
  return { text, changed: false }
}

/**
 * Resolve one approval headline into Chinese.
 * @param text - headline currently shown by the approval card.
 * @param machines - machine-translation functions in fallback order; a bare
 *   `null` means dictionary-only.
 * @returns final text and whether it differs from the input.
 */
export async function translateApprovalText(text, machines) {
  const source = String(text ?? '').trim()
  if (source === '') return { text: source, changed: false }
  for (const template of TEMPLATES) {
    const match = template.test(source)
    if (match === null) continue
    const frame = template.build(match)
    const tail = await translateProse(frame.tail ?? '', machines)
    const separator = frame.separator ?? ''
    return { text: `${frame.head}${separator}${tail.text}`, changed: true }
  }
  return translateProse(source, machines)
}
