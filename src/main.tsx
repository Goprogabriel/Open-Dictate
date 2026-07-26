import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "@/app/App";
import "@/locales";
import "@/styles.css";

if (new URLSearchParams(window.location.search).get("window") === "recorder") {
  document.documentElement.classList.add("recorder-window");
}

const root = document.getElementById("root");

if (!root) throw new Error("Root element was not found.");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
