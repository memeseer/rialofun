import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { Landing } from "./Landing.jsx";
import "./styles.css";

const host = window.location.hostname.toLowerCase();
const landingPreview = new URLSearchParams(window.location.search).has("landing");
const mainDomain = host === "rialofun.xyz" || host === "www.rialofun.xyz";
const Root = mainDomain || landingPreview ? Landing : App;

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
