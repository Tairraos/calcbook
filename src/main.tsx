import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { CalculatorWindow } from "./CalculatorWindow.tsx";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Calcbook root element is missing");

// 计算器子窗口复用同一前端包，按 URL 参数分流渲染。
const view = new URLSearchParams(window.location.search).get("view");
createRoot(root).render(view === "calculator" ? <CalculatorWindow /> : <App />);
