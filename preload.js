const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tonsave", {
  oscSend(message) {
    return ipcRenderer.invoke("osc:send", message);
  },
  getOscState() {
    return ipcRenderer.invoke("osc:get-state");
  },
  openAchievements() {
    return ipcRenderer.invoke("ui:open-achievements");
  },
  onOscMessage(callback) {
    if (typeof callback !== "function") return () => {};
    const handler = (_event, message) => callback(message);
    ipcRenderer.on("osc:message", handler);
    return () => {
      ipcRenderer.removeListener("osc:message", handler);
    };
  }
});
