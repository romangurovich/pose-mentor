import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "./styles.css";
import { App } from "./App.tsx";
import { I18nProvider, applyDocument, loadSettings } from "./ui/i18n.tsx";

// apply the saved theme and language before the first paint (no flash)
applyDocument(loadSettings());
// start loading the system voice list now; browsers fill it asynchronously
if (typeof speechSynthesis !== "undefined") speechSynthesis.getVoices();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
);
