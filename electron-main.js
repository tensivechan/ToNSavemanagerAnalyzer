const { app, BrowserWindow } = require("electron");
const { autoUpdater } = require("electron-updater");
const log = require("electron-log");
const path = require("path");

log.transports.file.level = "info";
autoUpdater.logger = log;
autoUpdater.autoDownload = true;

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 980,
    minWidth: 1100,
    minHeight: 760,
    backgroundColor: "#f6f4ef",
    title: "ToNSaveManager Analyzer",
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
