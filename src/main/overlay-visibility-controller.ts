export type OverlayFeature = 'listen' | 'ask' | 'settings' | 'shortcuts'
export type OverlayVisibility = Partial<Record<OverlayFeature, boolean>>

/** Desired overlay visibility, independent from Electron's transient isVisible. */
export class OverlayVisibilityController {
  private desired = new Set<OverlayFeature>()
  private uiHidden = false

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
    this.uiHidden = true
    return this.getDesiredNames()
  }

  showUi(): OverlayFeature[] {
    this.uiHidden = false
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
