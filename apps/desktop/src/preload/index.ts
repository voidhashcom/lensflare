import { contextBridge, ipcRenderer } from "electron";
import { RESTART_LOCAL_SERVER_CHANNEL } from "../ipc.ts";

contextBridge.exposeInMainWorld("lensflareDesktop", {
  restartLocalServer: () => ipcRenderer.invoke(RESTART_LOCAL_SERVER_CHANNEL) as Promise<void>,
});
