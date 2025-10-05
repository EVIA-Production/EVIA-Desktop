// apps/desktop/src/main/platform/win32.ts
import { Tray, Menu, nativeImage, BrowserWindow, app } from "electron";
import path from "path";
let tray: Tray | null = null;

function createTray() {
  if (tray) return tray;
  let iconPath = path.join(process.resourcesPath, "assets", "icon.png");
  const image = nativeImage.createFromPath(iconPath);
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  const menu = Menu.buildFromTemplate([
    {
      label: "Show",
      click: () => {
        BrowserWindow.getAllWindows().forEach((w) => w.show());
      },
    },
    { label: "Quit", role: "quit" },
  ]);
  tray.setToolTip("EVIA Desktop");
  tray.setContextMenu(menu);
  return tray;
}

export const api = {
  showTray(): void {
    try {
      createTray();
    } catch (e) {
      console.warn("[platform/win32] tray failed", e);
    }
  },
  workspaceTweaks(_mainWindow: BrowserWindow) {
    // Intentionally no-op on Windows for now
  },
  deepLinkScheme: "evia",
};
