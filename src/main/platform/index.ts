/* eslint-disable @typescript-eslint/no-var-requires */
// Runtime platform selection
const impl =
  process.platform === "darwin"
    ? require("./darwin").api
    : require("./win32").api;

export default impl as {
  showTray: () => void;
  workspaceTweaks: (win: Electron.BrowserWindow) => void;
  registerAudioIpc: (
    getHeaderWindow: () => Electron.BrowserWindow | null
  ) => void;
  deepLinkScheme: string;
};
