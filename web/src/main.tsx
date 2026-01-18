import { createRoot } from "react-dom/client";
import { App } from "./app";

export const mountApp = (container: HTMLElement) => {
  const root = createRoot(container);
  root.render(<App />);
  return root;
};

export const appRoot = mountApp(document.getElementById("root")!);
