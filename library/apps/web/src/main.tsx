import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import "./styles.css";

const root = document.getElementById("root");

if (!root) throw new Error("Missing application root");

createRoot(root).render(
  <StrictMode>
    <App apiBase={import.meta.env.VITE_API_BASE ?? ""} />
  </StrictMode>,
);
