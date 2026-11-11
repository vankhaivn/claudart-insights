import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles.css";
import { installTip } from "./tip.ts";

installTip(document.getElementById("tip")!);
createRoot(document.getElementById("root")!).render(<App />);
