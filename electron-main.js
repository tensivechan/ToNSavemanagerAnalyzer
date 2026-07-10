const { app, BrowserWindow } = require("electron");
const { ipcMain } = require("electron");
const log = require("electron-log");
const dgram = require("node:dgram");
const path = require("path");

log.transports.file.level = "info";

let autoUpdater = null;
let mainWindow = null;
let achievementsWindow = null;
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
  mainWindow = new BrowserWindow({
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
      sandbox: true,
      preload: path.join(__dirname, "preload.js")
    }
  });

  mainWindow.loadFile(path.join(__dirname, "outputs", "ton-save-analyzer.html"));
  return mainWindow;
}

function createAchievementsWindow() {
  if (achievementsWindow && !achievementsWindow.isDestroyed()) {
    achievementsWindow.focus();
    return achievementsWindow;
  }

  achievementsWindow = new BrowserWindow({
    width: 980,
    height: 860,
    minWidth: 860,
    minHeight: 680,
    backgroundColor: "#f6f4ef",
    title: "実績",
    icon: iconPath,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.js")
    }
  });

  achievementsWindow.loadFile(path.join(__dirname, "outputs", "ton-save-analyzer.html"), {
    query: { view: "achievements" }
  });

  achievementsWindow.on("closed", () => {
    achievementsWindow = null;
  });

  return achievementsWindow;
}

function padOscBuffer(buffer) {
  const remainder = buffer.length % 4;
  if (remainder === 0) return buffer;
  return Buffer.concat([buffer, Buffer.alloc(4 - remainder)]);
}

function encodeOscString(value) {
  return padOscBuffer(Buffer.from(`${String(value)}\0`, "utf8"));
}

function encodeOscValue(value) {
  if (typeof value === "boolean") {
    return { type: value ? "T" : "F", data: Buffer.alloc(0) };
  }
  if (Number.isInteger(value)) {
    const data = Buffer.alloc(4);
    data.writeInt32BE(value, 0);
    return { type: "i", data };
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const data = Buffer.alloc(4);
    data.writeFloatBE(value, 0);
    return { type: "f", data };
  }
  return { type: "s", data: encodeOscString(value) };
}

function encodeOscMessage(address, args = []) {
  const typeTags = [","];
  const chunks = [encodeOscString(address)];

  for (const arg of args) {
    const encoded = encodeOscValue(arg);
    typeTags.push(encoded.type);
    if (encoded.data.length > 0) {
      chunks.push(encoded.data);
    }
  }

  chunks.unshift(encodeOscString(typeTags.join("")));
  return Buffer.concat(chunks);
}

function sendOscMessage(message) {
  const host = message && message.host ? String(message.host) : "127.0.0.1";
  const port = Number(message && message.port) || 9000;
  const address = message && message.address ? String(message.address) : "";
  const args = Array.isArray(message && message.args) ? message.args : [];

  if (!address) {
    throw new Error("OSC address is required");
  }

  const packet = encodeOscMessage(address, args);
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    socket.once("error", error => {
      socket.close();
      reject(error);
    });
    socket.send(packet, port, host, error => {
      socket.close();
      if (error) reject(error);
      else resolve();
    });
  });
}

function setupAutoUpdater() {
  if (!autoUpdater) return;

  autoUpdater.autoDownload = true;
  autoUpdater.on("checking-for-update", () => {
    log.info("Checking for updates...");
  });

  autoUpdater.on("update-available", info => {
    log.info("Update available", info && info.version ? info.version : "");
  });

  autoUpdater.on("update-not-available", info => {
    log.info("No update available", info && info.version ? info.version : "");
  });

  autoUpdater.on("download-progress", progress => {
    log.info(`Update download progress: ${progress.percent.toFixed(1)}%`);
  });

  autoUpdater.on("update-downloaded", () => {
    autoUpdater.quitAndInstall();
  });

  autoUpdater.on("error", error => {
    log.error("Auto update error", error);
  });

  autoUpdater.checkForUpdates().catch(error => {
    log.error("Update check failed", error);
  });
}

ipcMain.handle("osc:send", async (_event, message) => {
  await sendOscMessage(message);
  return true;
});

ipcMain.handle("ui:open-achievements", () => {
  createAchievementsWindow();
  return true;
});

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
