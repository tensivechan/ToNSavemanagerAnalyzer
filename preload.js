const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tonsave", {
  oscSend(message) {
    return ipcRenderer.invoke("osc:send", message);
  },
  getLogState() {
    return ipcRenderer.invoke("log:get-state");
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
    openLogMonitor() {
      return ipcRenderer.invoke("ui:open-log-monitor");
    },
    onLogMessage(callback) {
      if (typeof callback !== "function") return () => {};
    const handler = (_event, message) => callback(message);
    ipcRenderer.on("log:message", handler);
    return () => {
      ipcRenderer.removeListener("log:message", handler);
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
