import { loadingStyles } from "../ui/loading.js";
import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/archivo";
import "@fontsource/dm-mono/400.css";
import "./style.css";
import { App } from "./App.js";
if (!document.getElementById("loading-styles")) {
  const style = document.createElement("style");
  style.id = "loading-styles";
  style.textContent = loadingStyles;
  document.head.append(style);
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
