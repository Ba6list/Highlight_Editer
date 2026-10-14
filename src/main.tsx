import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import Player from "./Player";
import "./styles.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {location.pathname === "/highlight/player" ? <Player /> : <App />}
  </React.StrictMode>,
);
