// ESLint per la UI di TurniCN.
// Gli script in ui/assets sono file classici caricati da index.html: condividono le dichiarazioni
// di primo livello (function/let/const/var) e le proprietà window.X. Qui le ricaviamo leggendo i file,
// così `no-undef` segnala davvero i nomi sbagliati senza falsi allarmi tra un file e l'altro.
import fs from "node:fs";
import path from "node:path";
import js from "@eslint/js";
import globals from "globals";

const ASSETS = "ui/assets";

function sharedGlobals() {
  const out = {};
  for (const f of fs.readdirSync(ASSETS).filter((n) => n.endsWith(".js"))) {
    const src = fs.readFileSync(path.join(ASSETS, f), "utf8");
    for (const m of src.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) out[m[1]] = "writable";
    for (const m of src.matchAll(/^(?:let|const|var)\s+([A-Za-z_$][\w$]*)/gm)) out[m[1]] = "writable";
    for (const m of src.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)) out[m[1]] = "writable";
  }
  return out;
}

export default [
  js.configs.recommended,
  {
    files: ["ui/assets/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: { ...globals.browser, ...sharedGlobals() },
    },
    rules: {
      // le funzioni di primo livello sono usate da altri file: si controllano solo le variabili locali
      "no-unused-vars": ["warn", { vars: "local", args: "none", caughtErrors: "none" }],
      "no-redeclare": "off", // stesse globali dichiarate nel file e ricavate sopra
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },
];
