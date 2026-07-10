const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tonsave", {
  oscSend(message) {
    return ipcRenderer.invoke("osc:send", message);
  },
  getLogState() {
    return ipcRenderer.invoke("log:get-state");
  },
  openAchievements() {
    return ipcRenderer.invoke("ui:open-achievements");
  },
  onLogMessage(callback) {
    if (typeof callback !== "function") return () => {};
    const handler = (_event, message) => callback(message);
    ipcRenderer.on("log:message", handler);
    return () => {
      ipcRenderer.removeListener("log:message", handler);
    };
  }
});
