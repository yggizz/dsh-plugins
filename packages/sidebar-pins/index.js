/**
 * Host half of the sidebar-pins bundle.
 *
 * The Desktop shell keeps the global panel pin list in memory only
 * (`@deepseek-ai/dsh-client-ui-sidebar`'s `createPanelPins`), so every client
 * reload restores "all launchers pinned". This bundle has no host behaviour:
 * its Client module remembers the unpin choices and re-applies them.
 */
export function apply() {}
