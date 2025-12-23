import { createRoot } from "react-dom/client";
import App from "./app";
import "./index.css";
const rootEl = document.querySelector('#root') as HTMLElement;
createRoot(rootEl).render(<App />);
