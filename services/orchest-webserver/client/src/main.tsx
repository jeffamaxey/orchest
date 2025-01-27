import CssBaseline from "@mui/material/CssBaseline";
import React from "react";
import ReactDOM from "react-dom";
import App from "./App";
import { DesignProvider, OrchestProvider } from "./contexts/Providers";

declare global {
  interface Document {
    fonts: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  interface WheelEvent {
    Intercom: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    wheelDeltaY?: number;
  }
}

window.addEventListener("load", async () => {
  try {
    // Load after fonts are ready, required by MDC
    await document.fonts.ready;

    ReactDOM.render(
      <DesignProvider>
        <OrchestProvider>
          <CssBaseline />
          <App />
        </OrchestProvider>
      </DesignProvider>,
      document.querySelector("#root")
    );
  } catch (error) {
    console.error(error);
  }
});
