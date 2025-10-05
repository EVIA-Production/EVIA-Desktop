/* Platform abstraction: picks darwin or win32 implementation at runtime */
/* eslint-disable @typescript-eslint/no-var-requires */
const impl =
  process.platform === "darwin"
    ? require("./darwin").api
    : require("./win32").api;

export default impl as {
  showTray: () => void;
  workspaceTweaks: (win: Electron.BrowserWindow) => void;
  deepLinkScheme: string;
  // optional future platform hooks
};
