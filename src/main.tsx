import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "./styles.css";
import { App } from "./App.tsx";
import { I18nProvider, applyDocument, loadSettings } from "./ui/i18n.tsx";

// apply the saved theme and language before the first paint (no flash)
applyDocument(loadSettings());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
);
