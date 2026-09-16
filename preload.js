const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tonsave", {
  oscSend(message) {
    return ipcRenderer.invoke("osc:send", message);
  },
  getAssetPath(fileName) {
    return ipcRenderer.invoke("app:get-asset-path", fileName);
  },
  getLogState() {
    return ipcRenderer.invoke("log:get-state");
  },
  getLogMonitorInfo() {
    return ipcRenderer.invoke("log:get-monitor-info");
  },
  setLogMonitorPath(filePath) {
    return ipcRenderer.invoke("log:set-monitor-path", filePath);
  },
  getUpdateState() {
    return ipcRenderer.invoke("update:get-state");
  },
  checkForUpdates() {
    return ipcRenderer.invoke("update:check");
  },
  installUpdate() {
    return ipcRenderer.invoke("update:install");
  },
  openAchievements() {
    return ipcRenderer.invoke("ui:open-achievements");
  },
  openRoundOverlay() {
    return ipcRenderer.invoke("ui:open-round-overlay");
  },
  getRoundOverlayVisibility() {
    return ipcRenderer.invoke("ui:get-round-overlay-visibility");
  },
  setRoundOverlayVisibility(visible) {
    return ipcRenderer.invoke("ui:set-round-overlay-visibility", Boolean(visible));
  },
  setRoundOverlayHeight(height) {
    return ipcRenderer.invoke("ui:set-round-overlay-height", Number(height));
  },
  onRoundOverlayVisibility(callback) {
    if (typeof callback !== "function") return () => {};
    const handler = (_event, visible) => callback(Boolean(visible));
    ipcRenderer.on("ui:round-overlay-visibility", handler);
    return () => ipcRenderer.removeListener("ui:round-overlay-visibility", handler);
  },
  openLogMonitor() {
    return ipcRenderer.invoke("ui:open-log-monitor");
  },
  openSettings() {
    return ipcRenderer.invoke("ui:open-settings");
  },
  chooseSoundFile() {
    return ipcRenderer.invoke("ui:choose-sound-file");
  },
  onLogMessage(callback) {
    if (typeof callback !== "function") return () => {};
    const handler = (_event, message) => callback(message);
    ipcRenderer.on("log:message", handler);
    return () => {
      ipcRenderer.removeListener("log:message", handler);
    };
  },
  onLogRawLine(callback) {
    if (typeof callback !== "function") return () => {};
    const handler = (_event, message) => callback(message);
    ipcRenderer.on("log:raw-line", handler);
    return () => {
      ipcRenderer.removeListener("log:raw-line", handler);
    };
  },
  onUpdateMessage(callback) {
    if (typeof callback !== "function") return () => {};
    const handler = (_event, message) => callback(message);
    ipcRenderer.on("update:message", handler);
    return () => {
      ipcRenderer.removeListener("update:message", handler);
    };
  }
});
