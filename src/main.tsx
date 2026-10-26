import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import Player from "./Player";
import ObsDock from "./ObsDock";
import "./styles.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {location.pathname === "/highlight/player" ? (
      <Player />
    ) : location.pathname === "/highlight/control" ? (
      <ObsDock />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
