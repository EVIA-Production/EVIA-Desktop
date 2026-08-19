export type OverlayFeature = 'listen' | 'ask' | 'settings' | 'shortcuts'
export type OverlayVisibility = Partial<Record<OverlayFeature, boolean>>

/** Desired overlay visibility, independent from Electron's transient isVisible. */
export class OverlayVisibilityController {
  private desired = new Set<OverlayFeature>()
  private uiHidden = false
  /**
   * Notified whenever the UI goes hidden or comes back. The menu-bar restore
   * icon is a pure function of this flag, and hanging it off the state itself
   * means a future sixth call site cannot forget to keep it in sync - which is
   * how the icon would silently stop appearing.
   */
  private onUiHiddenChange: ((uiHidden: boolean) => void) | null = null

  observeUiHidden(listener: (uiHidden: boolean) => void): void {
    this.onUiHiddenChange = listener
    listener(this.uiHidden)
  }

  set(visibility: OverlayVisibility): void {
    this.desired.clear()
    ;(['listen', 'ask', 'settings', 'shortcuts'] as OverlayFeature[]).forEach((name) => {
      if (visibility[name]) this.desired.add(name)
    })
  }

  show(feature: OverlayFeature): void {
    this.desired.add(feature)
  }

  hide(feature: OverlayFeature): void {
    this.desired.delete(feature)
  }

  isDesired(feature: OverlayFeature): boolean {
    return this.desired.has(feature)
  }

  hideUi(): OverlayFeature[] {
    const changed = !this.uiHidden
    this.uiHidden = true
    if (changed) this.onUiHiddenChange?.(true)
    return this.getDesiredNames()
  }

  showUi(): OverlayFeature[] {
    const changed = this.uiHidden
    this.uiHidden = false
    if (changed) this.onUiHiddenChange?.(false)
    return this.getDesiredNames()
  }

  isUiHidden(): boolean {
    return this.uiHidden
  }

  getDesiredNames(): OverlayFeature[] {
    return Array.from(this.desired)
  }

  getDesiredVisibility(): OverlayVisibility {
    const visibility: OverlayVisibility = {}
    this.desired.forEach((name) => { visibility[name] = true })
    return visibility
  }
}
