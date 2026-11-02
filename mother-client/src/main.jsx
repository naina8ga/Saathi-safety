import React from "react";
import { createRoot } from "react-dom/client";
import MotherApp from "./MotherApp.jsx";
import "./mother.css";
createRoot(document.getElementById("root")).render(<React.StrictMode><MotherApp /></React.StrictMode>);
