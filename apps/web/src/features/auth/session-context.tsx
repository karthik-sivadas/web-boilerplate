import { createContext, useContext } from "react";
import type { SessionIdentity } from "./identity";

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
  identity: SessionIdentity;
  epoch: number;
  reconcile(): Promise<void>;
  canAct(): boolean;
  signOut(): Promise<void>;
} | null>(null);
export const useSessionActions = () => useContext(SessionActions);
