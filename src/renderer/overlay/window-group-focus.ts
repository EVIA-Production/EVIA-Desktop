type WindowGroupState = { active?: boolean }

function setWindowGroupActive(active: boolean): void {
  document.documentElement.dataset.windowActive = active ? 'true' : 'false'
}

export function bindWindowGroupFocus(): void {
  const ipc = window.evia?.ipc
  setWindowGroupActive(false)

  // The visual focus latch follows the user's last physical click, not hover,
  // programmatic BrowserWindow.focus(), or which Taylos surface owns keyboard
  // input. Main process blur handling clears it only after focus leaves Taylos.
  window.addEventListener('pointerdown', () => {
    ipc?.send('window-group:clicked')
  }, true)

  ipc?.on('window-group-active-changed', setWindowGroupActive)
  const initialState = ipc?.invoke('window-group:get-active') as
    | Promise<WindowGroupState | undefined>
    | undefined
  if (initialState) {
    void initialState.then(
      (state) => setWindowGroupActive(Boolean(state?.active)),
      () => undefined,
    )
  }
}
