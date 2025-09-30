import { app, BrowserWindow, ipcMain, screen } from "electron";
import fs from "fs";
import path from "path";

export type FeatureName = "listen" | "ask" | "settings" | "shortcuts";

let headerWindow: BrowserWindow | null = null;
const childWindows: Map<FeatureName, BrowserWindow> = new Map();

// Track which windows were visible before hiding all (Glass parity)
const lastVisibleWindows: Set<FeatureName> = new Set();

const PAD = 8;
let settingsHideTimer: NodeJS.Timeout | null = null;

// Simple prefs store (persisted under userData/prefs.json)
type Prefs = { [key: string]: any };
let prefs: Prefs = {};
const prefsPath = path.join(app.getPath("userData"), "prefs.json");

function maskToken(t?: string | null): string | null {
  if (!t) return null;
  const s = String(t);
  if (s.length <= 10) return s;
  return `${s.slice(0, 6)}...${s.slice(Math.max(0, s.length - 4))}`;
}

function fullTokenLogEnabled(): boolean {
  const v = (process.env.EVIA_DEBUG_FULL_TOKEN || "").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function loadPrefs() {
  try {
    if (fs.existsSync(prefsPath)) {
      const raw = fs.readFileSync(prefsPath, "utf8");
      prefs = JSON.parse(raw || "{}");
      console.log(
        "[auth] Loaded prefs. Has token?",
        Boolean((prefs as any).auth_token)
      );
    }
  } catch {}
}
function savePrefs() {
  try {
    fs.mkdirSync(path.dirname(prefsPath), { recursive: true });
    fs.writeFileSync(prefsPath, JSON.stringify(prefs || {}, null, 2), "utf8");
    console.log(
      "[auth] Saved prefs. Has token?",
      Boolean((prefs as any).auth_token)
    );
  } catch {}
}
loadPrefs();

function broadcastAuthApply(payload: {
  token?: string | null;
  tokenType?: string | null;
}) {
  try {
    const masked = maskToken(payload?.token ?? null);
    console.log("[auth] Broadcasting auth:apply to windows", {
      header: Boolean(headerWindow && !headerWindow.isDestroyed()),
      childCount: childWindows.size,
      masked,
      tokenType: payload?.tokenType || null,
    });
    if (fullTokenLogEnabled()) {
      console.log(
        "[auth][FULL] Broadcasting raw token:",
        payload?.token || null
      );
    }
  } catch {}
  try {
    if (headerWindow && !headerWindow.isDestroyed()) {
      headerWindow.webContents.send("auth:apply", payload);
    }
  } catch {}
  for (const [, w] of childWindows) {
    try {
      if (w && !w.isDestroyed()) {
        w.webContents.send("auth:apply", payload);
      }
    } catch {}
  }
}

export function setAuthTokenInMain(token: string, tokenType?: string) {
  try {
    console.log("[auth] setAuthTokenInMain", {
      masked: maskToken(token),
      tokenType: tokenType || prefs.token_type || "Bearer",
    });
    if (fullTokenLogEnabled()) {
      console.log("[auth][FULL] setAuthTokenInMain raw token:", token);
    }
  } catch {}
  prefs.auth_token = token;
  if (tokenType) prefs.token_type = tokenType;
  savePrefs();
  broadcastAuthApply({
    token,
    tokenType: tokenType || prefs.token_type || "Bearer",
  });
}

export function clearAuthTokenInMain() {
  try {
    console.log("[auth] clearAuthTokenInMain");
  } catch {}
  delete prefs.auth_token;
  delete prefs.token_type;
  savePrefs();
  broadcastAuthApply({ token: null, tokenType: null });
}

function getHeaderBounds() {
  if (!headerWindow || headerWindow.isDestroyed()) return null;
  return headerWindow.getBounds();
}

function getWorkAreaForHeader() {
  if (!headerWindow || headerWindow.isDestroyed())
    return screen.getPrimaryDisplay().workArea;
  const b = headerWindow.getBounds();
  const display = screen.getDisplayNearestPoint({
    x: b.x + b.width / 2,
    y: b.y + b.height / 2,
  });
  return display.workArea;
}

function determineLayoutStrategy(
  headerBounds: Electron.Rectangle,
  screenWidth: number,
  screenHeight: number,
  workAreaX: number,
  workAreaY: number
) {
  const headerRelX = headerBounds.x - workAreaX;
  const headerRelY = headerBounds.y - workAreaY;
  const spaceBelow = screenHeight - (headerRelY + headerBounds.height);
  const spaceAbove = headerRelY;
  const spaceLeft = headerRelX;
  const spaceRight = screenWidth - (headerRelX + headerBounds.width);
  const headerCenterXRel = headerBounds.x - workAreaX + headerBounds.width / 2;
  const relativeX = headerCenterXRel / screenWidth;
  if (spaceBelow >= 400)
    return { primary: "below", secondary: relativeX < 0.5 ? "right" : "left" };
  if (spaceAbove >= 400)
    return { primary: "above", secondary: relativeX < 0.5 ? "right" : "left" };
  if (relativeX < 0.3 && spaceRight >= 800)
    return {
      primary: "right",
      secondary: spaceBelow > spaceAbove ? "below" : "above",
    };
  if (relativeX > 0.7 && spaceLeft >= 800)
    return {
      primary: "left",
      secondary: spaceBelow > spaceAbove ? "below" : "above",
    };
  return {
    primary: spaceBelow > spaceAbove ? "below" : "above",
    secondary: spaceRight > spaceLeft ? "right" : "left",
  };
}

function calculateFeatureLayout(
  visible: Partial<Record<FeatureName, boolean>>
) {
  const headerBounds = getHeaderBounds();
  if (!headerBounds) return {};
  const work = getWorkAreaForHeader();
  const screenWidth = work.width;
  const workAreaX = work.x;
  const workAreaY = work.y;

  const ask = childWindows.get("ask");
  const listen = childWindows.get("listen");
  const askVis = !!visible.ask && !!ask && !ask.isDestroyed();
  const listenVis = !!visible.listen && !!listen && !listen.isDestroyed();
  if (!askVis && !listenVis) return {};

  const askB = askVis ? ask!.getBounds() : null;
  const listenB = listenVis ? listen!.getBounds() : null;

  const headerCenterXRel = headerBounds.x - workAreaX + headerBounds.width / 2;
  const strategy = determineLayoutStrategy(
    headerBounds,
    work.width,
    work.height,
    workAreaX,
    workAreaY
  );
  const placeAbove = strategy.primary === "above";

  const layout: any = {};
  if (askVis && listenVis && askB && listenB) {
    let askXRel = headerCenterXRel - askB.width / 2;
    let listenXRel = askXRel - listenB.width - PAD;
    if (listenXRel < PAD) {
      listenXRel = PAD;
      askXRel = listenXRel + listenB.width + PAD;
    }
    if (askXRel + askB.width > screenWidth - PAD) {
      askXRel = screenWidth - PAD - askB.width;
      listenXRel = askXRel - listenB.width - PAD;
    }
    // Clamp Y to work area
    if (placeAbove) {
      const yAbs = headerBounds.y - PAD;
      const askY = Math.max(
        workAreaY,
        Math.min(yAbs - askB.height, workAreaY + work.height - askB.height)
      );
      const listenY = Math.max(
        workAreaY,
        Math.min(
          yAbs - listenB.height,
          workAreaY + work.height - listenB.height
        )
      );
      layout.ask = {
        x: Math.round(askXRel + workAreaX),
        y: Math.round(askY),
        width: askB.width,
        height: askB.height,
      };
      layout.listen = {
        x: Math.round(listenXRel + workAreaX),
        y: Math.round(listenY),
        width: listenB.width,
        height: listenB.height,
      };
    } else {
      const yAbs = headerBounds.y + headerBounds.height + PAD;
      const askY = Math.max(
        workAreaY,
        Math.min(yAbs, workAreaY + work.height - askB.height)
      );
      const listenY = Math.max(
        workAreaY,
        Math.min(yAbs, workAreaY + work.height - listenB.height)
      );
      layout.ask = {
        x: Math.round(askXRel + workAreaX),
        y: Math.round(askY),
        width: askB.width,
        height: askB.height,
      };
      layout.listen = {
        x: Math.round(listenXRel + workAreaX),
        y: Math.round(listenY),
        width: listenB.width,
        height: listenB.height,
      };
    }
  } else {
    const name = askVis ? "ask" : "listen";
    const winB = askVis ? askB! : listenB!;
    let xRel = headerCenterXRel - winB.width / 2;
    xRel = Math.max(PAD, Math.min(screenWidth - winB.width - PAD, xRel));
    let yPos;
    if (placeAbove) {
      yPos = headerBounds.y - workAreaY - PAD - winB.height;
    } else {
      yPos = headerBounds.y - workAreaY + headerBounds.height + PAD;
    }
    // Clamp Y within work area
    const yClamped = Math.max(0, Math.min(yPos, work.height - winB.height));
    layout[name] = {
      x: Math.round(xRel + workAreaX),
      y: Math.round(yClamped + workAreaY),
      width: winB.width,
      height: winB.height,
    };
  }
  return layout;
}

function clampBounds(bounds: Electron.Rectangle) {
  const work = getWorkAreaForHeader();
  const maxX = work.x + work.width - bounds.width;
  const maxY = work.y + work.height - bounds.height;
  const clamped = {
    x: Math.max(work.x, Math.min(bounds.x, maxX)),
    y: Math.max(work.y, Math.min(bounds.y, maxY)),
    width: bounds.width,
    height: bounds.height,
  };
  return clamped;
}

function getVisibleChildren(): FeatureName[] {
  const vis: FeatureName[] = [];
  for (const [name, w] of childWindows) {
    if (!w.isDestroyed() && w.isVisible()) vis.push(name);
  }
  return vis;
}

// Enforce deterministic stacking: listen > settings > ask
function enforceZOrder(active?: FeatureName) {
  const orderBase: FeatureName[] = ["ask", "settings", "listen"];
  const visible = getVisibleChildren();
  const ordered = orderBase.filter((n) => visible.includes(n));
  // If an active is specified and visible, bring it to top among children
  if (active && ordered.includes(active)) {
    const idx = ordered.indexOf(active);
    ordered.splice(idx, 1);
    ordered.push(active);
  }
  // Move in ascending order so last is on top
  for (const name of ordered) {
    const w = childWindows.get(name);
    if (!w || w.isDestroyed()) continue;
    try {
      if (process.platform === "darwin") w.setAlwaysOnTop(true, "screen-saver");
      else w.setAlwaysOnTop(true);
      w.moveTop();
    } catch {}
  }
  // Keep header above children
  try {
    headerWindow?.moveTop();
  } catch {}
  console.log("[overlay] enforceZOrder", { ordered, active });
}

function showWithAnimation(
  win: BrowserWindow,
  finalBounds: Electron.Rectangle
) {
  try {
    win.setOpacity(0);
  } catch {}
  // Start a few pixels up for a subtle slide-down
  const start = {
    x: finalBounds.x,
    y: Math.max(finalBounds.y - 6, getWorkAreaForHeader().y),
    width: finalBounds.width,
    height: finalBounds.height,
  };
  try {
    win.setBounds(clampBounds(start));
  } catch {}
  try {
    win.showInactive();
  } catch {}
  const steps = 6;
  let i = 0;
  const dy = (finalBounds.y - start.y) / steps;
  const step = () => {
    i++;
    const y = Math.round(start.y + dy * i);
    try {
      win.setBounds(clampBounds({ ...finalBounds, y }));
    } catch {}
    try {
      win.setOpacity(Math.min(1, i / steps));
    } catch {}
    if (i < steps) setTimeout(step, 16);
  };
  setTimeout(step, 16);
}

function hideWithAnimation(win: BrowserWindow) {
  const steps = 6;
  let i = steps;
  const startOpacity = win.getOpacity?.() ?? 1;
  const tick = () => {
    i--;
    const op = Math.max(0, (i / steps) * startOpacity);
    try {
      win.setOpacity(op);
    } catch {}
    if (i > 0) setTimeout(tick, 16);
    else {
      try {
        win.hide();
      } catch {}
      try {
        win.setOpacity(1);
      } catch {}
    }
  };
  setTimeout(tick, 0);
}

function updateChildLayouts() {
  const vis: Partial<Record<FeatureName, boolean>> = {};
  for (const [name, win] of childWindows) {
    if (!win.isDestroyed() && win.isVisible()) vis[name] = true;
  }
  if (!Object.keys(vis).length) return;
  const layout = calculateFeatureLayout(vis);
  for (const name of Object.keys(layout) as FeatureName[]) {
    const bounds = (layout as any)[name];
    const win = childWindows.get(name);
    if (win && !win.isDestroyed()) {
      try {
        win.setBounds(clampBounds(bounds));
      } catch {}
    }
  }
  enforceZOrder();
}

function toggleAllWindowsVisibility() {
  console.log("[WindowManager] Toggle all windows visibility requested");

  if (!headerWindow || headerWindow.isDestroyed()) {
    console.warn("[WindowManager] Header window not available for toggle");
    return { ok: false };
  }

  const headerVisible = headerWindow.isVisible();

  if (headerVisible) {
    // Hide all windows - first save which ones are currently visible
    lastVisibleWindows.clear();

    // Exclude settings from the global hide/restore so hover-settings remain stable
    childWindows.forEach((win, name) => {
      if (name === "settings") return;
      if (win && !win.isDestroyed() && win.isVisible()) {
        lastVisibleWindows.add(name);
      }
    });

    // Hide all child windows first
    lastVisibleWindows.forEach((name) => {
      const win = childWindows.get(name);
      if (win && !win.isDestroyed()) {
        win.hide();
      }
    });

    // Then hide header
    headerWindow.hide();

    console.log(
      "[WindowManager] Hidden all windows, saved state:",
      Array.from(lastVisibleWindows)
    );
    return { ok: true, action: "hidden" };
  } else {
    // Show all previously visible windows
    headerWindow.show();

    // Restore previously visible windows (exclude settings to avoid toggling it)
    lastVisibleWindows.forEach((name) => {
      const win = childWindows.get(name);
      if (win && !win.isDestroyed()) {
        win.show();
      }
    });

    console.log(
      "[WindowManager] Restored all windows:",
      Array.from(lastVisibleWindows)
    );
    return { ok: true, action: "shown" };
  }
}

function handleWindowVisibilityRequest(
  name: FeatureName,
  shouldBeVisible: boolean
) {
  console.log(
    `[WindowManager] Request: set '${name}' visibility to ${shouldBeVisible}`
  );
  const win = childWindows.get(name);
  if (!win || win.isDestroyed()) return { ok: false };

  if (name !== "settings") {
    const isCurrentlyVisible = win.isVisible();
    if (isCurrentlyVisible === shouldBeVisible) {
      console.log(
        `[WindowManager] Window '${name}' is already in the desired state.`
      );
      return { ok: true };
    }
  }

  // Settings special-case (hover show/hide with delay)
  if (name === "settings") {
    if (shouldBeVisible) {
      if (settingsHideTimer) {
        clearTimeout(settingsHideTimer);
        settingsHideTimer = null;
      }
      const pos = calculateSettingsWindowPosition();
      if (pos) {
        try {
          win.setBounds(pos);
        } catch {}
      }
      try {
        win.show();
      } catch {}
      try {
        win.moveTop();
      } catch {}
    } else {
      if (settingsHideTimer) clearTimeout(settingsHideTimer);
      settingsHideTimer = setTimeout(() => {
        try {
          if (!win.isDestroyed()) win.hide();
        } catch {}
        settingsHideTimer = null;
      }, 400);
    }
    enforceZOrder();
    updateChildLayouts(); // Ensure layout update for settings
    return { ok: true };
  }

  // Listen/Ask coordinated placement
  const other: FeatureName | null =
    name === "listen" ? "ask" : name === "ask" ? "listen" : null;
  const otherWin = other ? childWindows.get(other) : null;
  const visibility: any = {};
  visibility[name] = shouldBeVisible;
  if (other && otherWin && !otherWin.isDestroyed() && otherWin.isVisible()) {
    visibility[other] = true;
  }
  const layout = calculateFeatureLayout(visibility);
  const target = (layout as any)[name];

  if (shouldBeVisible) {
    if (!target) return { ok: false };
    const startPos = { ...target };
    // Glass offsets: listen slides in from left, ask slides in from top
    if (name === "listen") startPos.x -= 50;
    if (name === "ask") startPos.y -= 20;
    try {
      win.setOpacity(0);
    } catch {}
    try {
      win.setBounds(clampBounds(startPos));
    } catch {}
    try {
      win.show();
    } catch {}
    try {
      win.moveTop();
    } catch {}
    // snap to final and fade in (simple mimic of movement manager)
    try {
      win.setBounds(clampBounds(target));
    } catch {}
    try {
      win.setOpacity(1);
    } catch {}
  } else {
    if (!win.isVisible()) return { ok: true };
    const cur = win.getBounds();
    const endPos = { ...cur };
    if (name === "listen") endPos.x -= 50;
    if (name === "ask") endPos.y -= 20;
    try {
      win.setOpacity(0);
    } catch {}
    try {
      win.setBounds(clampBounds(endPos));
    } catch {}
    try {
      win.hide();
    } catch {}
  }

  // Apply layout to any other visible windows
  Object.keys(layout).forEach((n) => {
    if (n === name) return;
    const w = childWindows.get(n as FeatureName);
    if (w && !w.isDestroyed()) {
      const b = (layout as any)[n];
      console.log(
        `[Layout Debug] ${
          n === "ask" ? "Ask" : "Listen"
        } Window Bounds: height=${b.height}, width=${b.width}`
      );
      try {
        w.setBounds(clampBounds(b));
      } catch {}
    }
  });
  enforceZOrder(name);
  updateChildLayouts(); // Explicitly call after visibility change
  return { ok: true };
}

function calculateSettingsWindowPosition() {
  const header = getHeaderBounds();
  if (!header) return null;
  const settings = childWindows.get("settings");
  if (!settings || settings.isDestroyed()) return null;
  const settingsB = settings.getBounds();
  const display = screen.getDisplayNearestPoint({
    x: header.x + header.width / 2,
    y: header.y + header.height / 2,
  });
  const {
    x: workAreaX,
    y: workAreaY,
    width: screenWidth,
    height: screenHeight,
  } = display.workArea;
  const buttonPadding = 170;
  const x = header.x + header.width - settingsB.width + buttonPadding;
  const y = header.y + header.height + 5;
  const clampedX = Math.max(
    workAreaX + 10,
    Math.min(workAreaX + screenWidth - settingsB.width - 10, x)
  );
  const clampedY = Math.max(
    workAreaY + 10,
    Math.min(workAreaY + screenHeight - settingsB.height - 10, y)
  );
  return {
    x: Math.round(clampedX),
    y: Math.round(clampedY),
    width: settingsB.width,
    height: settingsB.height,
  };
}

function childCommonOptions(parent?: BrowserWindow) {
  return {
    parent,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    hiddenInMissionControl: true,
    webPreferences: {
      preload:
        process.env.NODE_ENV === "development"
          ? path.join(process.cwd(), "src/main/preload.cjs")
          : path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  } as const;
}

function ensureChildWindow(name: FeatureName) {
  if (childWindows.has(name)) return childWindows.get(name)!;
  const parent = headerWindow || undefined;
  let win: BrowserWindow;
  const common = childCommonOptions(parent);
  if (name === "listen") {
    // Start with a compact listen window (will grow as transcripts arrive)
    win = new BrowserWindow({ ...common, width: 400, height: 260 });
  } else if (name === "ask") {
    // Match Glass ask width 600
    win = new BrowserWindow({ ...common, width: 600, height: 520 });
  } else if (name === "settings") {
    // Match Glass settings width 240, maxHeight 400 - increase height to accommodate all buttons
    win = new BrowserWindow({
      ...common,
      width: 240,
      height: 450,
      maxHeight: 500,
      minHeight: 300,
      parent: undefined,
    });
  } else {
    win = new BrowserWindow({
      ...common,
      width: 353,
      height: 720,
      parent: undefined,
    });
  }
  try {
    win.setContentProtection(true);
  } catch {}
  try {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch {}
  if (process.platform === "darwin") {
    try {
      win.setWindowButtonVisibility(false);
    } catch {}
  }
  const dev = process.env.NODE_ENV === "development";
  const base = dev
    ? "http://localhost:5174"
    : `file://${path.join(__dirname, "../renderer")}`;
  // Ensure we load the overlay entry in dev
  const file = dev
    ? `${base}/overlay.html?view=${name}`
    : `${base}/overlay.html?view=${name}`;
  try {
    win.loadURL(file);
  } catch (e) {
    console.error(`[Load Error] ${name}:`, e);
  }
  // Do not auto-open DevTools for child windows; it can affect visibility toggles
  childWindows.set(name, win);
  // reinforce z-order
  try {
    if (process.platform === "darwin") win.setAlwaysOnTop(true, "screen-saver");
    else win.setAlwaysOnTop(true);
  } catch {}
  try {
    win.moveTop();
  } catch {}

  // Reassert on-top when focus changes or window is shown
  const reassert = () => {
    try {
      if (!win.isDestroyed() && win.isVisible()) {
        if (process.platform === "darwin")
          win.setAlwaysOnTop(true, "screen-saver");
        else win.setAlwaysOnTop(true);
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        win.moveTop();
      }
    } catch {}
  };
  win.on("blur", reassert);
  win.on("show", reassert);
  // Place stacking order: settings above ask; listen above settings
  try {
    if (name === "settings") win.setAlwaysOnTop(true, "screen-saver");
    if (name === "listen") win.setAlwaysOnTop(true, "screen-saver");
  } catch {}
  return win;
}

function setExclusiveClicks(active?: BrowserWindow) {
  for (const [, w] of childWindows) {
    if (w.isDestroyed()) continue;
    if (active && w.id === active.id) {
      try {
        w.setIgnoreMouseEvents(false);
      } catch {}
    } else {
      try {
        w.setIgnoreMouseEvents(true, { forward: true });
      } catch {}
    }
  }
}

export function getHeaderWindow() {
  return headerWindow;
}

export function createHeaderWindow() {
  // Match Glass defaults precisely
  const primary = screen.getPrimaryDisplay();
  const { x: workAreaX, y: workAreaY, width: workAreaWidth } = primary.workArea;
  const DEFAULT_WINDOW_WIDTH = 353;
  const HEADER_HEIGHT = 47;
  const initialX = Math.round(
    workAreaX + (workAreaWidth - DEFAULT_WINDOW_WIDTH) / 2
  );
  const initialY = workAreaY + 21;

  headerWindow = new BrowserWindow({
    width: DEFAULT_WINDOW_WIDTH,
    height: HEADER_HEIGHT,
    x: initialX,
    y: initialY,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    hasShadow: false,
    resizable: false,
    movable: true,
    backgroundColor: "#00000000",
    useContentSize: true,
    fullscreenable: false,
    skipTaskbar: true,
    show: true, // Explicitly show the window
    minimizable: false,
    maximizable: false,
    closable: false,
    webPreferences: {
      preload:
        process.env.NODE_ENV === "development"
          ? path.join(process.cwd(), "src/main/preload.cjs")
          : path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      devTools: true,
      backgroundThrottling: false,
    },
    titleBarStyle: "hidden",
  });

  try {
    headerWindow.setContentProtection(true);
  } catch {}
  try {
    headerWindow.setAlwaysOnTop(true, "screen-saver");
  } catch {}
  try {
    headerWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch {}
  if (process.platform === "darwin") {
    try {
      headerWindow.setWindowButtonVisibility(false);
    } catch {}
  }

  const dev = process.env.NODE_ENV === "development";
  // Load overlay entry explicitly in dev
  const url = dev
    ? "http://localhost:5174/overlay.html?view=header"
    : `file://${path.join(__dirname, "../renderer/overlay.html")}?view=header`;
  try {
    headerWindow.loadURL(url);
  } catch (e) {
    console.error("[Load Error] Header:", e);
  }
  headerWindow.show();
  headerWindow.focus();
  headerWindow.moveTop();
  headerWindow.webContents.openDevTools({ mode: "detach" }); // Force open DevTools for debugging
  if (dev) {
    try {
      headerWindow.webContents.openDevTools({ mode: "detach" });
    } catch {}
  }
  try {
    headerWindow.moveTop();
  } catch {}

  headerWindow.on("moved", () => {
    updateChildLayouts();
  });
  headerWindow.on("resize", () => {
    updateChildLayouts();
  });
  screen.on("display-metrics-changed", () => {
    updateChildLayouts();
  });
  // Maintain all-spaces visibility aggressively
  headerWindow.on("focus", () => {
    console.log("[WindowManager] Header gained focus");
    try {
      if (!headerWindow) return;
      if (process.platform === "darwin")
        headerWindow.setAlwaysOnTop(true, "screen-saver");
      else headerWindow.setAlwaysOnTop(true);
      headerWindow.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
      });
      headerWindow.moveTop();
    } catch {}
  });

  // Periodic reassert while any child is visible
  const bump = setInterval(() => {
    try {
      if (!headerWindow) {
        clearInterval(bump);
        return;
      }
      // Always keep header on top, even with no child visible
      if (process.platform === "darwin")
        headerWindow.setAlwaysOnTop(true, "screen-saver");
      else headerWindow.setAlwaysOnTop(true);
      headerWindow.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
      });
      headerWindow.moveTop();
    } catch {}
  }, 1000);
  headerWindow.on("blur", () => {
    console.log("[WindowManager] Header lost focus");
    try {
      if (!headerWindow) return;
      if (process.platform === "darwin")
        headerWindow.setAlwaysOnTop(true, "screen-saver");
      else headerWindow.setAlwaysOnTop(true);
      headerWindow.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
      });
      headerWindow.moveTop();
    } catch {}
  });
  headerWindow.on("closed", () => {
    headerWindow = null;
    for (const [, w] of childWindows) {
      try {
        if (!w.isDestroyed()) w.destroy();
      } catch {}
    }
    childWindows.clear();
  });

  registerIpc();
}

function registerIpc() {
  // Window control IPC
  ipcMain.handle("win:show", (_e, name: FeatureName) => {
    const win = ensureChildWindow(name);
    const wasVisible = win.isVisible();
    const desired = !wasVisible;
    const result = handleWindowVisibilityRequest(name, desired);
    if (result.ok) {
      const nowVisible = desired;
      return { ok: true, toggled: nowVisible ? "shown" : "hidden", name };
    }
    return { ok: false };
  });

  // Idempotent show (ensure visible regardless of current state)
  ipcMain.handle("win:ensureShown", (_e, name: FeatureName) => {
    ensureChildWindow(name);
    const result = handleWindowVisibilityRequest(name, true);
    if (result.ok) {
      return { ok: true, toggled: "shown", name };
    }
    return { ok: false };
  });

  ipcMain.handle("win:hide", (_e, name: FeatureName) => {
    const res = handleWindowVisibilityRequest(name, false);
    return { ok: !!res.ok };
  });

  ipcMain.handle("win:getHeaderPosition", () => {
    const b = getHeaderBounds();
    return b || { x: 0, y: 0, width: 0, height: 0 };
  });

  ipcMain.handle("win:moveHeaderTo", (_e, x: number, y: number) => {
    if (!headerWindow) return { ok: false };
    const work = getWorkAreaForHeader();
    const b = headerWindow.getBounds();
    const clampedX = Math.max(
      work.x,
      Math.min(x, work.x + work.width - b.width)
    );
    const clampedY = Math.max(
      work.y,
      Math.min(y, work.y + work.height - b.height)
    );
    try {
      headerWindow.setPosition(clampedX, clampedY);
    } catch {}
    updateChildLayouts();
    return { ok: true };
  });

  ipcMain.handle("win:resizeHeader", (_e, width: number, height: number) => {
    if (!headerWindow) return { ok: false };
    const b = headerWindow.getBounds();
    const centerX = b.x + b.width / 2;
    const newX = Math.round(centerX - width / 2);
    const work = getWorkAreaForHeader();
    const clampedX = Math.max(
      work.x,
      Math.min(work.x + work.width - width, newX)
    );
    const wasResizable = headerWindow.isResizable();
    if (!wasResizable)
      try {
        headerWindow.setResizable(true);
      } catch {}
    try {
      headerWindow.setBounds({ x: clampedX, y: b.y, width, height });
    } catch {}
    if (!wasResizable)
      try {
        headerWindow.setResizable(false);
      } catch {}
    updateChildLayouts();
    return { ok: true };
  });

  // Glass-compatible aliases and additional controls
  ipcMain.handle("get-header-position", () => {
    const b = getHeaderBounds();
    return b || { x: 0, y: 0, width: 0, height: 0 };
  });
  ipcMain.handle("move-header-to", (_e, x: number, y: number) => {
    if (!headerWindow) return { ok: false };
    const work = getWorkAreaForHeader();
    const b = headerWindow.getBounds();
    const clampedX = Math.max(
      work.x,
      Math.min(x, work.x + work.width - b.width)
    );
    const clampedY = Math.max(
      work.y,
      Math.min(y, work.y + work.height - b.height)
    );
    try {
      headerWindow.setPosition(clampedX, clampedY);
    } catch {}
    updateChildLayouts();
    return { ok: true };
  });

  // Settings hover lifecycle (Glass parity)
  ipcMain.on("show-settings-window", () => {
    handleWindowVisibilityRequest("settings", true);
  });
  ipcMain.on("hide-settings-window", () => {
    handleWindowVisibilityRequest("settings", false);
  });
  ipcMain.on("cancel-hide-settings-window", () => {
    if (settingsHideTimer) {
      clearTimeout(settingsHideTimer);
      settingsHideTimer = null;
    }
  });

  // Header animation finished (no-op but log for parity)
  ipcMain.on("header-animation-finished", (_e, state) => {
    console.log("[WindowManager] Header animation finished with state:", state);
  });

  // Dynamic height adjustment from renderer (Ask/Listen)
  ipcMain.handle(
    "adjust-window-height",
    (_e, { winName, height }: { winName: FeatureName; height: number }) => {
      try {
        const name = String(winName) as FeatureName;
        const win = childWindows.get(name);
        if (!win || win.isDestroyed()) return { ok: false };
        // Cap dynamic height to 75% of the screen work area to avoid huge windows
        const work = getWorkAreaForHeader();
        const maxAllowed = Math.round(work.height * 0.75);
        const targetHeight = Math.max(
          40,
          Math.min(maxAllowed || 800, Math.round(height))
        );
        console.log(
          "[Layout Debug] adjustWindowHeight: targetHeight=" + targetHeight
        );
        const b = win.getBounds();
        const newBounds = {
          x: b.x,
          y: b.y,
          width: b.width,
          height: targetHeight,
        };
        console.log(
          "[Layout Debug] calculateWindowHeightAdjustment: targetHeight=" +
            targetHeight
        );
        win.setBounds(clampBounds(newBounds));
        updateChildLayouts();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: (e as any)?.message };
      }
    }
  );

  // Prefs IPC
  ipcMain.handle("prefs:get", () => {
    try {
      const masked = maskToken((prefs as any)?.auth_token || null);
      console.log(
        "[prefs] get -> has",
        Boolean(prefs && Object.keys(prefs).length),
        { masked, tokenType: (prefs as any)?.token_type || null }
      );
    } catch {}
    return { ok: true, prefs };
  });
  ipcMain.handle("prefs:set", (_e, patch: Prefs) => {
    try {
      if (patch && typeof patch === "object") {
        try {
          const masked = maskToken((patch as any)?.auth_token || null);
          console.log("[prefs] set <- patch", {
            keys: Object.keys(patch || {}),
            masked,
            tokenType: (patch as any)?.token_type || null,
          });
        } catch {}
        prefs = { ...prefs, ...patch };
        savePrefs();
        return { ok: true };
      }
    } catch (e) {
      return { ok: false, error: String(e) };
    }
    return { ok: false };
  });

  // Auth token IPC (centralized storage + broadcast)
  ipcMain.handle(
    "auth:set-token",
    (_e, data: { token: string; tokenType?: string }) => {
      try {
        console.log("[auth] IPC auth:set-token called", {
          masked: maskToken(data?.token),
          tokenType: data?.tokenType || "Bearer",
        });
        if (fullTokenLogEnabled()) {
          console.log(
            "[auth][FULL] IPC auth:set-token raw token:",
            data?.token
          );
        }
        if (!data || !data.token) return { ok: false, error: "Missing token" };
        setAuthTokenInMain(data.token, data.tokenType);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    }
  );
  ipcMain.handle("auth:clear-token", () => {
    try {
      console.log("[auth] IPC auth:clear-token called");
      clearAuthTokenInMain();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  ipcMain.on("close-window", (event, name) => {
    const win = childWindows.get(name);
    if (win) win.hide(); // Instead of ensureChildWindow(false)
  });

  // Toggle all windows visibility (Glass parity)
  ipcMain.handle("win:toggleAll", () => {
    return toggleAllWindowsVisibility();
  });

  // Add quit functionality
  ipcMain.handle("app:quit", () => {
    console.log("Quit IPC handler called - about to quit app");
    console.log("Current windows:", BrowserWindow.getAllWindows().length);

    // Force close all windows first
    const allWindows = BrowserWindow.getAllWindows();
    allWindows.forEach((window) => {
      if (!window.isDestroyed()) {
        console.log("Force closing window");
        window.destroy();
      }
    });

    // Then quit the application - use app.exit() like Glass does
    setTimeout(() => {
      console.log("Calling app.exit(0)");
      app.exit(0);
    }, 100);

    return { ok: true };
  });
}
