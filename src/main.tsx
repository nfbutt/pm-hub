import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./ui/tokens.css";
import { App } from "./App";
import { applyTheme, readTheme } from "./ui/Theme";

// The theme is on the page before the first paint, so it never flashes.
applyTheme(readTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
