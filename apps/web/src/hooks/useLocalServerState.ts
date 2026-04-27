import type { DesktopLocalServerState } from "@lensflare/contracts";
import { useEffect, useState } from "react";

import {
  getDesktopLocalServerState,
  hasDesktopBridge,
  subscribeToDesktopLocalServerState,
} from "~/data/desktopBridge";

/**
 * Mirror the desktop main process's local-server lifecycle into a React
 * value. Subscribes to `LOCAL_SERVER_STATE_CHANNEL` via the preload bridge
 * and primes the initial value from {@link getDesktopLocalServerState}.
 *
 * Returns `null` outside the desktop shell (web preview, browser tab) so
 * callers can render a "not running locally" affordance instead of an
 * inscrutable "starting…" spinner.
 */
export function useLocalServerState(): DesktopLocalServerState | null {
  const [state, setState] = useState<DesktopLocalServerState | null>(null);

  useEffect(() => {
    if (!hasDesktopBridge()) {
      return;
    }

    let cancelled = false;
    void getDesktopLocalServerState()
      .then((initial) => {
        if (!cancelled && initial) {
          setState(initial);
        }
      })
      .catch(() => {
        // Bridge can throw during teardown; render path stays as-is.
      });

    const unsubscribe = subscribeToDesktopLocalServerState((next) => {
      setState(next);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return state;
}
