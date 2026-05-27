import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { GameProvider } from "./context/GameContext";
import { MechanicsProvider } from "./context/MechanicsContext";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MechanicsProvider>
      <GameProvider>
        <App />
      </GameProvider>
    </MechanicsProvider>
  </StrictMode>
);
