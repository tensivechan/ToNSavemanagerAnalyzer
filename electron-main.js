const { app, BrowserWindow } = require("electron");
const log = require("electron-log");
const path = require("path");

log.transports.file.level = "info";

let autoUpdater = null;
try {
  ({ autoUpdater } = require("electron-updater"));
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
} catch (error) {
  log.warn("electron-updater is unavailable; auto update is disabled", error);
}

const iconPath = app.isPackaged
  ? path.join(process.resourcesPath, "app-icon.ico")
  : path.join(__dirname, "assets", "app-icon.ico");

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 980,
    minWidth: 1100,
    minHeight: 760,
    backgroundColor: "#f6f4ef",
    title: "ToNSavemanagerAnalyzer",
    icon: iconPath,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.loadFile(path.join(__dirname, "outputs", "ton-save-analyzer.html"));
  return win;
}

function setupAutoUpdater() {
  if (!autoUpdater) return;

  autoUpdater.on("update-downloaded", () => {
    autoUpdater.quitAndInstall();
  });

  autoUpdater.on("error", error => {
    log.error("Auto update error", error);
  });

  autoUpdater.checkForUpdatesAndNotify().catch(error => {
    log.error("Update check failed", error);
  });
}

app.whenReady().then(() => {
  createWindow();
  if (app.isPackaged) setupAutoUpdater();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
