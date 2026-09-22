import React from "react";
import ReactDOM from "react-dom/client";
import { LoginApp } from "@/login-app";
import { registerPwa } from "@/lib/api";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><LoginApp /></React.StrictMode>);
registerPwa();
