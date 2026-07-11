const { app, BrowserWindow } = require("electron");
const { ipcMain } = require("electron");
const log = require("electron-log");
const fs = require("node:fs");
const dgram = require("node:dgram");
const os = require("node:os");
const path = require("path");

log.transports.file.level = "info";

let autoUpdater = null;
let mainWindow = null;
let achievementsWindow = null;
let oscSocket = null;
let debugLogPollTimer = null;
let activeLogFile = "";
let activeLogOffset = 0;
let activeLogRemainder = "";
let liveRoundHistory = [];
let liveRoundSequence = 0;
let liveRoundFinalizedKey = "";
const updateState = {
  status: "idle",
  currentVersion: "",
  latestVersion: "",
  downloadedVersion: "",
  percent: 0,
  info: null,
  error: ""
};
updateState.currentVersion = app.getVersion();
const oscLiveState = {
  note: "",
  roundType: null,
  roundTypeLabel: "",
  mapId: null,
  mapName: "",
  playerCount: null,
  terrorCount: null,
  terrorIds: [],
  terrorData: [],
  result: null,
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

function broadcastLogMessage(message) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("log:message", message);
    }
  }
}

function broadcastUpdateMessage(message) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("update:message", message);
    }
  }
}

function snapshotUpdateState() {
  return {
    ...updateState
  };
}

function setUpdateState(partial = {}) {
  Object.assign(updateState, partial);
  broadcastUpdateMessage({
    state: snapshotUpdateState(),
    receivedAt: Date.now()
  });
}

function getVrcLogDirectory() {
  return path.join(os.homedir(), "AppData", "LocalLow", "VRChat", "VRChat");
}

function isOutputLogFile(name) {
  return /^output_log_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.txt$/i.test(String(name || ""));
}

function parseOutputLogStamp(name) {
  const match = String(name || "").match(/^output_log_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.txt$/i);
  if (!match) return Number.NEGATIVE_INFINITY;
  const [, year, month, day, hour, minute, second] = match;
  const stamp = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );
  return Number.isFinite(stamp) ? stamp : Number.NEGATIVE_INFINITY;
}

async function findLatestLogFile() {
  const dir = getVrcLogDirectory();
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    let latest = null;
    for (const entry of entries) {
      if (!entry.isFile() || !isOutputLogFile(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      const stat = await fs.promises.stat(fullPath);
      const fileStamp = parseOutputLogStamp(entry.name);
      if (
        !latest ||
        fileStamp > latest.fileStamp ||
        (fileStamp === latest.fileStamp && (stat.mtimeMs > latest.mtimeMs || (stat.mtimeMs === latest.mtimeMs && stat.size > latest.size)))
      ) {
        latest = {
          path: fullPath,
          fileStamp,
          mtimeMs: stat.mtimeMs,
          size: stat.size
        };
      }
    }
    return latest;
  } catch (error) {
    log.warn("Failed to inspect VRChat log directory", error);
    return null;
  }
}

function parseLogJsonCandidate(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  const candidate = text.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function parseLogTerrorData(value) {
  if (Array.isArray(value)) {
    return value.map(item => {
      if (item && typeof item === "object") {
        return {
          ...item,
          i: item.i !== undefined ? Number(item.i) : item.id !== undefined ? Number(item.id) : null
        };
      }
      const number = Number(item);
      return Number.isFinite(number) ? { i: number } : null;
    }).filter(Boolean);
  }

  if (typeof value === "string" && value.trim()) {
    const json = parseLogJsonCandidate(value);
    if (Array.isArray(json)) return parseLogTerrorData(json);
    return value
      .split(/[\s,;|]+/)
      .map(item => Number(item))
      .filter(Number.isFinite)
      .map(i => ({ i }));
  }

  return [];
}

function parseLogLine(line) {
  const text = normalizeLogMessage(line);
  if (!text) return null;
  const update = {};

  const roundStartMatch = text.match(/This round is taking place at (.+?) \((\d+)\) and the round type is (.+)$/i);
  if (roundStartMatch) {
    const mapName = roundStartMatch[1].trim();
    const mapId = Number(roundStartMatch[2]);
    const roundTypeLabel = roundStartMatch[3].trim();
    update.mapName = mapName;
    update.mapId = mapId;
    update.roundTypeLabel = roundTypeLabel;
    update.roundType = roundTypeIdFromLabel(roundTypeLabel);
    update.note = `${roundTypeLabel} @ ${mapName}`;
    return update;
  }

  const killersMatch = text.match(/Killers have been set\s*-?\s*([0-9 ]+)\s*\/\/\s*Round type is (.+)$/i);
  if (killersMatch) {
    const terrorData = killersMatch[1]
      .trim()
      .split(/\s+/)
      .map(value => Number(value))
      .filter(Number.isFinite)
      .map(i => ({ i }));
    const roundTypeLabel = killersMatch[2].trim();
    update.terrorData = terrorData;
    update.terrorCount = terrorData.length;
    update.roundTypeLabel = roundTypeLabel;
    if (update.roundType === undefined || update.roundType === null) {
      update.roundType = roundTypeIdFromLabel(roundTypeLabel);
    }
    return update;
  }

  if (/^RoundOver$/i.test(text) || /^Round was valid\.$/i.test(text) || /^Verified Round End$/i.test(text)) {
    return { raw: text, finalize: true };
  }

  if (/^Lived in round\.$/i.test(text)) {
    update.result = 1;
    return update;
  }

  if (/^Died in round\.$/i.test(text) || /^You Died iN the Round$/i.test(text) || /^Player lost, not killer$/i.test(text)) {
    update.result = 0;
    return update;
  }

  const json = parseLogJsonCandidate(text);
  if (json && typeof json === "object") {
    if (json.Note !== undefined || json.note !== undefined) update.note = json.note ?? json.Note;
    if (json.RT !== undefined || json.roundType !== undefined || json.rt !== undefined) update.roundType = json.roundType ?? json.RT ?? json.rt;
    if (json.MapID !== undefined || json.mapId !== undefined || json.mapID !== undefined) update.mapId = json.mapId ?? json.MapID ?? json.mapID;
    if (json.pc !== undefined || json.playerCount !== undefined) update.playerCount = json.playerCount ?? json.pc;
    if (json.TD !== undefined || json.terrorData !== undefined || json.terrorIds !== undefined) {
      update.terrorData = parseLogTerrorData(json.terrorData ?? json.TD ?? json.terrorIds);
      update.terrorCount = update.terrorData.length;
    }
  }

  const patterns = [
    { key: "note", re: /(Terror Name|Note|Name)\s*[:=]\s*(.+)$/i },
    { key: "roundType", re: /\b(?:RoundType|RT)\s*[:=]\s*(-?\d+)\b/i },
    { key: "mapId", re: /\b(?:MapID|MapId|mapid)\s*[:=]\s*(-?\d+)\b/i },
    { key: "playerCount", re: /\b(?:Player Count|PlayerCount|pc)\s*[:=]\s*(\d+)\b/i },
    { key: "terrorCount", re: /\b(?:TerrorCount|TDCount|TD)\s*[:=]\s*(\d+)\b/i },
    { key: "terrorData", re: /\b(?:TerrorIDs|TerrorIds|TD|terrorIds)\s*[:=]\s*(.+)$/i }
  ];

  for (const { key, re } of patterns) {
    const match = text.match(re);
    if (!match) continue;
    const value = match[1];
    if (key === "terrorData") {
      const data = parseLogTerrorData(value);
      if (data.length) {
        update.terrorData = data;
        update.terrorCount = data.length;
      }
      continue;
    }
    update[key] = value;
  }

  return Object.keys(update).length ? update : null;
}

function normalizeLogMessage(line) {
  const text = String(line || "").trim();
  if (!text) return "";
  const prefixed = text.match(/^\d{4}\.\d{2}\.\d{2}\s+\d{2}:\d{2}:\d{2}\s+[A-Za-z]+\s+-\s*(.+)$/);
  if (prefixed) return prefixed[1].trim();
  return text;
}

function processLogChunk(chunk, state = {}) {
  const emit = state.emit !== false;
  activeLogRemainder += String(chunk || "");
  const lines = activeLogRemainder.split(/\r?\n/);
  activeLogRemainder = lines.pop() || "";
  let changed = false;

  for (const line of lines) {
    let lineChanged = false;
    const normalizedLine = normalizeLogMessage(line);
    if (/This round is taking place at (.+?) \((\d+)\) and the round type is (.+)$/i.test(normalizedLine)) {
      if (finalizeLiveRound()) {
        lineChanged = true;
      }
    }
    const update = parseLogLine(normalizedLine);
    if (!update) continue;
    const didChange = applyLiveOscRecord(update);
    if (update.finalize) {
      if (finalizeLiveRound()) {
        lineChanged = true;
      }
    }
    if (didChange || lineChanged) {
      changed = true;
      if (emit) {
        broadcastLogMessage({
          filePath: activeLogFile,
          line,
          update,
          state: snapshotOscState(),
          receivedAt: Date.now()
        });
      }
    }
  }

  return changed;
}

async function refreshDebugLogTail() {
  const latest = await findLatestLogFile();
  if (!latest) return;

  if (latest.path !== activeLogFile) {
    activeLogFile = latest.path;
    activeLogOffset = 0;
    activeLogRemainder = "";
    applyLiveOscRecord({ reset: true });
    broadcastLogMessage({
      filePath: activeLogFile,
      line: "",
      update: { reset: true },
      state: snapshotOscState(),
      receivedAt: Date.now()
    });
    log.info(`Watching VRChat log: ${activeLogFile}`);
  }

  if (latest.size < activeLogOffset) {
    activeLogOffset = latest.size;
    activeLogRemainder = "";
    return;
  }

  if (latest.size === activeLogOffset) return;

  const length = latest.size - activeLogOffset;
  const handle = await fs.promises.open(activeLogFile, "r");
  try {
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, activeLogOffset);
    activeLogOffset = latest.size;
    processLogChunk(buffer.toString("utf8"), { emit: true });
  } finally {
    await handle.close();
  }
}

function startDebugLogWatcher() {
  if (debugLogPollTimer) return;
  refreshDebugLogTail().catch(error => log.warn("Initial VRChat debug log scan failed", error));
  debugLogPollTimer = setInterval(() => {
    refreshDebugLogTail().catch(error => log.warn("VRChat debug log tail refresh failed", error));
  }, 1000);
  if (typeof debugLogPollTimer.unref === "function") {
    debugLogPollTimer.unref();
  }
}

function stopDebugLogWatcher() {
  if (debugLogPollTimer) {
    clearInterval(debugLogPollTimer);
    debugLogPollTimer = null;
  }
  activeLogFile = "";
  activeLogOffset = 0;
  activeLogRemainder = "";
  liveRoundHistory = [];
  liveRoundSequence = 0;
  liveRoundFinalizedKey = "";
}

function coerceNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

const roundTypeLabelToId = new Map([
  ["classic", 1],
  ["fog", 2],
  ["punish", 3],
  ["punished", 3],
  ["sabotage", 4],
  ["insanity", 5],
  ["bloodbath", 6],
  ["double trouble", 7],
  ["lvl2", 7],
  ["ex", 8],
  ["ghost", 9],
  ["unbound", 10],
  ["randomizer", 11],
  ["classic.exe", 12],
  ["cracked", 12],
  ["midnight", 50],
  ["alternate", 51],
  ["fog alternate", 52],
  ["ghost alternate", 53],
  ["mystic moon", 100],
  ["blood moon", 101],
  ["twilight moon", 102],
  ["solstice", 103],
  ["run", 104],
  ["run!", 104],
  ["8 pages", 105],
  ["gigabyte", 106],
  ["rift monsters", 107]
]);

function roundTypeIdFromLabel(label) {
  const normalized = normalizeText(label).replace(/\s+/g, " ");
  return roundTypeLabelToId.get(normalized) ?? null;
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
  const liveRecord = buildLiveRoundRecord();
  return {
    note: oscLiveState.note,
    roundType: oscLiveState.roundType,
    roundTypeLabel: oscLiveState.roundTypeLabel,
    mapId: oscLiveState.mapId,
    mapName: oscLiveState.mapName,
    playerCount: oscLiveState.playerCount,
    terrorCount: oscLiveState.terrorCount,
    terrorIds: [...oscLiveState.terrorIds],
    terrorData: oscLiveState.terrorData.map(item => ({ ...item })),
    result: oscLiveState.result,
    lastAddress: oscLiveState.lastAddress,
    lastMessageAt: oscLiveState.lastMessageAt,
    raw: { ...oscLiveState.raw },
    liveRecord,
    liveRecords: liveRoundHistory.map(record => cloneLiveRoundRecord(record))
  };
}

function cloneLiveRoundRecord(record) {
  return {
    ...record,
    terrorData: Array.isArray(record.terrorData) ? record.terrorData.map(item => ({ ...item })) : [],
    terrorLabels: Array.isArray(record.terrorLabels) ? [...record.terrorLabels] : [],
    players: Array.isArray(record.players) ? [...record.players] : [],
    raw: record.raw && typeof record.raw === "object" ? { ...record.raw } : {}
  };
}

function buildLiveRoundRecord() {
  const terrorData = Array.isArray(oscLiveState.terrorData)
    ? oscLiveState.terrorData.map(item => ({ ...item }))
    : [];
  return {
    recordKey: `live:${liveRoundSequence}`,
    sourceIndex: liveRoundSequence,
    sourceFileIndex: Number.MAX_SAFE_INTEGER,
    sourceFile: activeLogFile,
    timestamp: new Date(oscLiveState.lastMessageAt || Date.now()).toISOString(),
    note: oscLiveState.note,
    itemName: "",
    mapId: oscLiveState.mapId,
    mapName: oscLiveState.mapName,
    rawRoundType: oscLiveState.roundType,
    roundType: oscLiveState.roundType,
    roundTypeExtra: oscLiveState.roundTypeLabel,
    playerCount: oscLiveState.playerCount,
    players: [],
    terrorData,
    terrorLabels: terrorData
      .map(item => {
        const id = Number(item && item.i);
        return Number.isFinite(id) ? String(id) : "";
      })
      .filter(Boolean),
    terrorCount: Number.isFinite(oscLiveState.terrorCount) ? oscLiveState.terrorCount : terrorData.length,
    expectedTerrorCount: expectedTerrorCount(oscLiveState.roundType),
    terrorComposition: terrorComposition(oscLiveState.roundType, terrorData),
    result: oscLiveState.result,
    errors: "",
    content: "",
    contentLength: 0,
    raw: { ...oscLiveState.raw }
  };
}

function roundFingerprint(record) {
  if (!record) return "";
  const terrorIds = Array.isArray(record.terrorData)
    ? record.terrorData.map(item => Number(item && item.i)).filter(Number.isFinite).join(",")
    : "";
  return [
    record.note || "",
    record.mapId ?? "",
    record.roundType ?? "",
    record.roundTypeExtra || "",
    record.playerCount ?? "",
    terrorIds,
    record.result ?? ""
  ].join("|");
}

function finalizeLiveRound() {
  const record = buildLiveRoundRecord();
  const hasContent =
    record.note ||
    record.mapId !== null && record.mapId !== undefined ||
    record.roundType !== null && record.roundType !== undefined ||
    record.playerCount !== null && record.playerCount !== undefined ||
    record.terrorData.length > 0 ||
    record.result !== null && record.result !== undefined;
  if (!hasContent) return false;
  const key = roundFingerprint(record);
  if (!key || key === liveRoundFinalizedKey) return false;
  liveRoundFinalizedKey = key;
  liveRoundSequence += 1;
  record.recordKey = `live:${liveRoundSequence}`;
  record.sourceIndex = liveRoundSequence;
  liveRoundHistory.push(cloneLiveRoundRecord(record));
  return true;
}

function applyLiveOscRecord(partial = {}) {
  let changed = false;
  if (partial.reset) {
    oscLiveState.note = "";
    oscLiveState.roundType = null;
    oscLiveState.roundTypeLabel = "";
    oscLiveState.mapId = null;
    oscLiveState.mapName = "";
    oscLiveState.playerCount = null;
    oscLiveState.terrorCount = null;
    oscLiveState.terrorIds = [];
    oscLiveState.terrorData = [];
    oscLiveState.result = null;
    oscLiveState.raw = {};
    liveRoundHistory = [];
    liveRoundSequence = 0;
    liveRoundFinalizedKey = "";
    changed = true;
  }

  if (partial.note !== undefined) {
    const next = String(partial.note || "");
    if (oscLiveState.note !== next) changed = true;
    oscLiveState.note = next;
  }
  if (partial.roundType !== undefined) {
    const next = coerceNumber(partial.roundType);
    if (oscLiveState.roundType !== next) changed = true;
    oscLiveState.roundType = next;
  }
  if (partial.roundTypeLabel !== undefined) {
    const next = String(partial.roundTypeLabel || "");
    if (oscLiveState.roundTypeLabel !== next) changed = true;
    oscLiveState.roundTypeLabel = next;
  }
  if (partial.mapId !== undefined) {
    const next = coerceNumber(partial.mapId);
    if (oscLiveState.mapId !== next) changed = true;
    oscLiveState.mapId = next;
  }
  if (partial.mapName !== undefined) {
    const next = String(partial.mapName || "");
    if (oscLiveState.mapName !== next) changed = true;
    oscLiveState.mapName = next;
  }
  if (partial.playerCount !== undefined) {
    const next = coerceNumber(partial.playerCount);
    if (oscLiveState.playerCount !== next) changed = true;
    oscLiveState.playerCount = next;
  }
  if (partial.terrorCount !== undefined) {
    const next = coerceNumber(partial.terrorCount);
    if (oscLiveState.terrorCount !== next) changed = true;
    oscLiveState.terrorCount = next;
  }
  if (partial.result !== undefined) {
    const next = partial.result === null ? null : Number(partial.result);
    if (oscLiveState.result !== next) changed = true;
    oscLiveState.result = Number.isFinite(next) ? next : null;
  }

  if (Array.isArray(partial.terrorIds)) {
    const next = partial.terrorIds.map(coerceNumber).filter(Number.isFinite);
    if (JSON.stringify(oscLiveState.terrorIds) !== JSON.stringify(next)) changed = true;
    oscLiveState.terrorIds = next;
  }

  if (Array.isArray(partial.terrorData)) {
    const next = partial.terrorData
      .filter(item => item && typeof item === "object")
      .map(item => ({
        ...item,
        i: coerceNumber(item.i),
        g: item.g !== undefined ? item.g : undefined
      }));
    if (JSON.stringify(oscLiveState.terrorData) !== JSON.stringify(next)) changed = true;
    oscLiveState.terrorData = next;
  } else if (oscLiveState.terrorIds.length) {
    const next = oscLiveState.terrorIds.map(id => ({ i: id }));
    if (JSON.stringify(oscLiveState.terrorData) !== JSON.stringify(next)) changed = true;
    oscLiveState.terrorData = next;
  }

  oscLiveState.lastMessageAt = Date.now();
  return changed;
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
  updateState.currentVersion = app.getVersion();
  setUpdateState({
    status: "idle",
    currentVersion: app.getVersion(),
    latestVersion: "",
    downloadedVersion: "",
    percent: 0,
    info: null,
    error: ""
  });
  autoUpdater.on("checking-for-update", () => {
    log.info("Checking for updates...");
    setUpdateState({
      status: "checking",
      currentVersion: app.getVersion(),
      error: ""
    });
  });

  autoUpdater.on("update-available", info => {
    log.info("Update available", info && info.version ? info.version : "");
    setUpdateState({
      status: "available",
      latestVersion: info && info.version ? String(info.version) : "",
      info: info || null,
      error: ""
    });
  });

  autoUpdater.on("update-not-available", info => {
    log.info("No update available", info && info.version ? info.version : "");
    setUpdateState({
      status: "none",
      latestVersion: info && info.version ? String(info.version) : "",
      info: info || null,
      percent: 0,
      error: ""
    });
  });

  autoUpdater.on("download-progress", progress => {
    log.info(`Update download progress: ${progress.percent.toFixed(1)}%`);
    setUpdateState({
      status: "downloading",
      percent: Number(progress && progress.percent) || 0,
      info: progress || null,
      error: ""
    });
  });

  autoUpdater.on("update-downloaded", info => {
    setUpdateState({
      status: "downloaded",
      downloadedVersion: info && info.version ? String(info.version) : updateState.latestVersion,
      info: info || null,
      percent: 100,
      error: ""
    });
  });

  autoUpdater.on("error", error => {
    log.error("Auto update error", error);
    setUpdateState({
      status: "error",
      error: error && error.message ? error.message : String(error || "Update error")
    });
  });

  autoUpdater.checkForUpdates().catch(error => {
    log.error("Update check failed", error);
    setUpdateState({
      status: "error",
      error: error && error.message ? error.message : String(error || "Update check failed")
    });
  });
}

ipcMain.handle("osc:send", async (_event, message) => {
  await sendOscMessage(message);
  return true;
});

ipcMain.handle("log:get-state", () => snapshotOscState());
ipcMain.handle("osc:get-state", () => snapshotOscState());
ipcMain.handle("update:get-state", () => snapshotUpdateState());
ipcMain.handle("update:check", async () => {
  if (!autoUpdater) {
    return snapshotUpdateState();
  }
  setUpdateState({
    status: "checking",
    currentVersion: app.getVersion(),
    error: ""
  });
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    log.error("Manual update check failed", error);
    setUpdateState({
      status: "error",
      error: error && error.message ? error.message : String(error || "Update check failed")
    });
  }
  return snapshotUpdateState();
});
ipcMain.handle("update:install", async () => {
  if (!autoUpdater || updateState.status !== "downloaded") {
    return false;
  }
  autoUpdater.quitAndInstall(false, true);
  return true;
});

ipcMain.handle("ui:open-achievements", () => {
  createAchievementsWindow();
  return true;
});

app.whenReady().then(() => {
  createWindow();
  startDebugLogWatcher();
  if (app.isPackaged) setupAutoUpdater();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  stopDebugLogWatcher();
  stopOscListener();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
