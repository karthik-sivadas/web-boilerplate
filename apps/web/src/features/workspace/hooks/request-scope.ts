import { useEffect, useRef } from "react";
/** Abort owned mutations/exports on unmount without reusing an aborted StrictMode signal. */
export function useRequestScope() {
  const active = useRef(true);
  const requests = useRef(new Set<AbortController>());
  useEffect(() => {
    active.current = true;
    const owned = requests.current;
    return () => {
      active.current = false;
      for (const request of owned) request.abort();
      owned.clear();
    };
  }, []);
  return {
    isActive: () => active.current,
    start: () => {
      const request = new AbortController();
      requests.current.add(request);
      return request;
    },
    finish: (request: AbortController) => requests.current.delete(request),
  };
}
