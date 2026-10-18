/**
 * Single owner of the command palette visibility so the top bar, rail and
 * keyboard shortcut all open the same layer.
 */
export function useCommandPalette() {
  const open = useState<boolean>('command-palette-open', () => false)

  function show() {
    open.value = true
  }

  function hide() {
    open.value = false
  }

  function toggle() {
    open.value = !open.value
  }

  return { open, show, hide, toggle }
}
