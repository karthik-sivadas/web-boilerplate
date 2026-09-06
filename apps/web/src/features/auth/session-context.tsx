import { createContext, useContext } from "react";

export const sessionChannelName = "workbench-session-changed";
let sender: string | undefined;
export const sessionSender = () => (sender ??= crypto.randomUUID());
export function notifySessionChange() {
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(sessionChannelName);
    channel.postMessage({ source: sessionSender() });
    channel.close();
  }
}
export const SessionActions = createContext<{
  canAct(): boolean;
  signOut(): Promise<void>;
} | null>(null);
export const useSessionActions = () => useContext(SessionActions);
