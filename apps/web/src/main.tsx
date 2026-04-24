import "./reactDevUserTimingGuard";

import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./index.css";

import { ToastProvider } from "~/components/ui/toast";
import { createAppRouter } from "./router";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing #root container");
}

const userAgent = navigator.userAgent;
document.documentElement.dataset.runtime = userAgent.includes("Electron") ? "electron" : "web";
document.documentElement.dataset.platform = userAgent.includes("Mac")
  ? "macos"
  : userAgent.includes("Windows")
    ? "windows"
    : "linux";

const router = createAppRouter();

createRoot(root).render(
  <StrictMode>
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>
  </StrictMode>,
);
