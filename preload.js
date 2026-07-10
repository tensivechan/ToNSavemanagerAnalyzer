const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tonsave", {
  oscSend(message) {
    return ipcRenderer.invoke("osc:send", message);
  },
  openAchievements() {
    return ipcRenderer.invoke("ui:open-achievements");
  }
});
