const { app, BrowserWindow } = require("electron");
const { ipcMain } = require("electron");
const log = require("electron-log");
const dgram = require("node:dgram");
const path = require("path");

log.transports.file.level = "info";

let autoUpdater = null;
let mainWindow = null;
let achievementsWindow = null;
let oscSocket = null;
const oscLiveState = {
  note: "",
  roundType: null,
  mapId: null,
  playerCount: null,
  terrorCount: null,
  terrorIds: [],
  terrorData: [],
  lastAddress: "",
  lastMessageAt: 0,
  raw: {}
};
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

function broadcastOscMessage(message) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("osc:message", message);
    }
  }
}

function coerceNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeAddress(address) {
  return String(address || "").trim().replace(/\0+$/g, "").toLowerCase();
}

function readOscString(buffer, offset) {
  let end = offset;
  while (end < buffer.length && buffer[end] !== 0) {
    end += 1;
  }
  const value = buffer.toString("utf8", offset, end);
  end = end < buffer.length ? end + 1 : end;
  while (end % 4 !== 0) {
    end += 1;
  }
  return { value, offset: end };
}

function readOscValue(buffer, offset, tag) {
  switch (tag) {
    case "i":
      return { value: buffer.readInt32BE(offset), offset: offset + 4 };
    case "f":
      return { value: buffer.readFloatBE(offset), offset: offset + 4 };
    case "s":
      return readOscString(buffer, offset);
    case "b": {
      const size = buffer.readInt32BE(offset);
      const start = offset + 4;
      const end = start + size;
      let next = end;
      while (next % 4 !== 0) {
        next += 1;
      }
      return { value: buffer.subarray(start, end), offset: next };
    }
    case "T":
      return { value: true, offset };
    case "F":
      return { value: false, offset };
    case "N":
    case "I":
      return { value: null, offset };
    default:
      return { value: null, offset };
  }
}

function parseOscPacket(buffer, offset = 0) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return [];
  const { value: address, offset: afterAddress } = readOscString(buffer, offset);
  if (!address) return [];

  if (address === "#bundle") {
    let current = afterAddress + 8;
    const messages = [];
    while (current + 4 <= buffer.length) {
      const size = buffer.readInt32BE(current);
      current += 4;
      if (!Number.isFinite(size) || size <= 0 || current + size > buffer.length) break;
      messages.push(...parseOscPacket(buffer.subarray(current, current + size), 0));
      current += size;
    }
    return messages;
  }

  if (afterAddress >= buffer.length) return [{ address, args: [] }];
  const { value: typeTags, offset: afterTypeTags } = readOscString(buffer, afterAddress);
  const args = [];
  let current = afterTypeTags;
  for (const tag of String(typeTags || "").slice(1)) {
    const result = readOscValue(buffer, current, tag);
    args.push(result.value);
    current = result.offset;
  }
  return [{ address, args, typeTags }];
}

function snapshotOscState() {
  return {
    note: oscLiveState.note,
    roundType: oscLiveState.roundType,
    mapId: oscLiveState.mapId,
    playerCount: oscLiveState.playerCount,
    terrorCount: oscLiveState.terrorCount,
    terrorIds: [...oscLiveState.terrorIds],
    terrorData: oscLiveState.terrorData.map(item => ({ ...item })),
    lastAddress: oscLiveState.lastAddress,
    lastMessageAt: oscLiveState.lastMessageAt,
    raw: { ...oscLiveState.raw }
  };
}

function applyLiveOscRecord(partial = {}) {
  if (partial.reset) {
    oscLiveState.note = "";
    oscLiveState.roundType = null;
    oscLiveState.mapId = null;
    oscLiveState.playerCount = null;
    oscLiveState.terrorCount = null;
    oscLiveState.terrorIds = [];
    oscLiveState.terrorData = [];
    oscLiveState.raw = {};
  }

  if (partial.note !== undefined) oscLiveState.note = String(partial.note || "");
  if (partial.roundType !== undefined) oscLiveState.roundType = coerceNumber(partial.roundType);
  if (partial.mapId !== undefined) oscLiveState.mapId = coerceNumber(partial.mapId);
  if (partial.playerCount !== undefined) oscLiveState.playerCount = coerceNumber(partial.playerCount);
  if (partial.terrorCount !== undefined) oscLiveState.terrorCount = coerceNumber(partial.terrorCount);

  if (Array.isArray(partial.terrorIds)) {
    oscLiveState.terrorIds = partial.terrorIds.map(coerceNumber).filter(Number.isFinite);
  }

  if (Array.isArray(partial.terrorData)) {
    oscLiveState.terrorData = partial.terrorData
      .filter(item => item && typeof item === "object")
      .map(item => ({
        ...item,
        i: coerceNumber(item.i),
        g: item.g !== undefined ? item.g : undefined
      }));
  } else if (oscLiveState.terrorIds.length) {
    oscLiveState.terrorData = oscLiveState.terrorIds.map(id => ({ i: id }));
  }

  oscLiveState.lastMessageAt = Date.now();
}

function applyLiveOscMessage(message) {
  const address = normalizeAddress(message && message.address);
  const args = Array.isArray(message && message.args) ? message.args : [];
  const first = args[0];
  oscLiveState.lastAddress = message && message.address ? String(message.address) : "";
  oscLiveState.raw[address] = args.length <= 1 ? first : [...args];

  if (address === "/tonsave/live/reset" || address === "/tonsave/reset") {
    applyLiveOscRecord({ reset: true });
    return true;
  }

  if (address === "/tonsave/live/record" || address === "/tonsave/record") {
    const candidate = typeof first === "string" ? first : (args.length ? JSON.stringify(args[0]) : "");
    if (candidate) {
      try {
        const parsed = JSON.parse(candidate);
        if (parsed && typeof parsed === "object") {
          applyLiveOscRecord({
            note: parsed.note ?? parsed.Note ?? "",
            roundType: parsed.roundType ?? parsed.RT ?? parsed.rt,
            mapId: parsed.mapId ?? parsed.MapID ?? parsed.mapID,
            playerCount: parsed.playerCount ?? parsed.pc,
            terrorCount: parsed.terrorCount ?? parsed.TDCount ?? parsed.tdCount,
            terrorIds: Array.isArray(parsed.terrorIds) ? parsed.terrorIds : undefined,
            terrorData: Array.isArray(parsed.terrorData) ? parsed.terrorData : undefined
          });
          return true;
        }
      } catch (error) {
        log.warn("Failed to parse live OSC record", error);
      }
    }
  }

  const key = {
    "/tonsave/live/note": "note",
    "/avatar/parameters/tonsave_note": "note",
    "/avatar/parameters/note": "note",
    "/tonsave/live/roundtype": "roundType",
    "/tonsave/live/rt": "roundType",
    "/avatar/parameters/tonsave_roundtype": "roundType",
    "/avatar/parameters/roundtype": "roundType",
    "/avatar/parameters/rt": "roundType",
    "/tonsave/live/mapid": "mapId",
    "/avatar/parameters/tonsave_mapid": "mapId",
    "/avatar/parameters/mapid": "mapId",
    "/tonsave/live/playercount": "playerCount",
    "/tonsave/live/pc": "playerCount",
    "/avatar/parameters/tonsave_playercount": "playerCount",
    "/avatar/parameters/playercount": "playerCount",
    "/avatar/parameters/pc": "playerCount",
    "/tonsave/live/terrorcount": "terrorCount",
    "/tonsave/live/tdcount": "terrorCount",
    "/avatar/parameters/tonsave_terrorcount": "terrorCount",
    "/avatar/parameters/terrorcount": "terrorCount",
    "/avatar/parameters/tdcount": "terrorCount",
    "/tonsave/live/terrorids": "terrorIds"
  }[address];

  if (!key) {
    return false;
  }

  switch (key) {
    case "note":
      applyLiveOscRecord({ note: first });
      break;
    case "roundType":
      applyLiveOscRecord({ roundType: first });
      break;
    case "mapId":
      applyLiveOscRecord({ mapId: first });
      break;
    case "playerCount":
      applyLiveOscRecord({ playerCount: first });
      break;
    case "terrorCount":
      applyLiveOscRecord({ terrorCount: first });
      break;
    case "terrorIds":
      applyLiveOscRecord({
        terrorIds: args.map(coerceNumber).filter(Number.isFinite)
      });
      break;
  }

  return true;
}

function startOscListener() {
  if (oscSocket) return;
  const port = Number(process.env.TONSAVE_OSC_PORT) || 9001;
  oscSocket = dgram.createSocket({ type: "udp4", reuseAddr: true });
  oscSocket.on("message", buffer => {
    try {
      const messages = parseOscPacket(buffer);
      for (const message of messages) {
        if (!message || !message.address) continue;
        const handled = applyLiveOscMessage(message);
        broadcastOscMessage({
          address: message.address,
          args: Array.isArray(message.args) ? message.args : [],
          handled,
          state: snapshotOscState(),
          receivedAt: Date.now()
        });
      }
    } catch (error) {
      log.error("Failed to parse OSC packet", error);
    }
  });
  oscSocket.on("error", error => {
    log.error("OSC listener error", error);
    try {
      oscSocket.close();
    } catch {
      /* ignore */
    }
    oscSocket = null;
  });
  oscSocket.bind(port, "127.0.0.1", () => {
    log.info(`OSC listener ready on 127.0.0.1:${port}`);
  });
}

function stopOscListener() {
  if (!oscSocket) return;
  try {
    oscSocket.close();
  } catch {
    /* ignore */
  }
  oscSocket = null;
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

ipcMain.handle("osc:get-state", () => snapshotOscState());

ipcMain.handle("ui:open-achievements", () => {
  createAchievementsWindow();
  return true;
});

app.whenReady().then(() => {
  createWindow();
  startOscListener();
  if (app.isPackaged) setupAutoUpdater();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", stopOscListener);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
