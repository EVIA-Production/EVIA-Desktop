// apps/desktop/src/main/platform/darwin.ts
import { app, Tray, Menu, nativeImage, BrowserWindow } from "electron";
import path from "path";

let tray: Tray | null = null;

function createTray() {
  if (tray) return tray;
  // Try to load a template icon (add one under assets if available)
  let iconPath = path.join(process.resourcesPath, "assets", "iconTemplate.png");
  const image = nativeImage.createFromPath(iconPath);
  // Tray requires a valid image or string path; if load failed, create empty tray with app name icon fallback
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  const context = Menu.buildFromTemplate([
    {
      label: "Show",
      click: () => {
        BrowserWindow.getAllWindows().forEach((w) => w.show());
      },
    },
    { type: "separator" },
    { label: "Quit", role: "quit" },
  ]);
  tray.setToolTip("EVIA Desktop");
  tray.setContextMenu(context);
  return tray;
}

export const api = {
  showTray(): void {
    try {
      createTray();
    } catch (e) {
      console.warn("[platform/darwin] tray failed", e);
    }
  },
  workspaceTweaks(mainWindow: BrowserWindow) {
    try {
      mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    } catch {}
  },
  deepLinkScheme: "evia", // Info.plist via builder handles registration
};
