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

window.__ModuleLoader__.load({
  id: '@local/dsh-hide-branch',
  factory() {
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
  },
})
