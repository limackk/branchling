import { readFileSync, writeFileSync } from "node:fs";

const base = readFileSync("_base.css", "utf8");
const exec = readFileSync("_exec.css", "utf8");
const chrome = readFileSync("_chrome.html", "utf8");

const DARK = `
    :root{
      --bg:#1A1F2E; --bg-card:#232938; --fg:#E2E8F0; --fg-muted:#94A3B8;
      --border:#2D3748; --accent:#E89A7D; --accent-soft:#3D2A23;
      --in-flight:#34D399; --in-flight-bg:rgba(52,211,153,.15);
      --foreign:#E8A25D; --foreign-bg:rgba(232,162,93,.12);
      --shadow:0 1px 3px rgba(0,0,0,.3);
    }`;

const LIGHT = `
    :root{
      --bg:#FAF8F5; --bg-card:#FFFFFF; --fg:#1E3A5C; --fg-muted:#6B7B8E;
      --border:#E5E0D8; --accent:#C97B5C; --accent-soft:#F4DED1;
      --in-flight:#059669; --in-flight-bg:rgba(5,150,105,.13);
      --foreign:#B4530E; --foreign-bg:rgba(180,83,14,.09);
      --shadow:0 1px 3px rgba(30,58,92,.05);
    }
    .b-pending{color:rgb(220,38,38);}
    .b-running{background:rgba(37,99,235,.15);color:rgb(37,99,235);}
    .b-done{background:rgba(124,58,237,.15);color:rgb(124,58,237);}
    .b-blocked{background:rgba(180,83,9,.15);color:rgb(180,83,9);}
    .tab .count,.scope b,.who .on{color:#FFFFFF;}
    .seg.closed{background:rgba(201,123,92,.45);}
    .seg.active{box-shadow:0 0 0 3px rgba(201,123,92,.20);}
    .now{box-shadow:0 0 0 1px rgba(201,123,92,.18);}
    .chain{background:rgba(201,123,92,.07);}
    .row-task.crit{background:rgba(201,123,92,.08);}
    .mini .tick{color:rgba(124,58,237,.75);}
    .bar{background:rgba(30,58,92,.12);}
    .up-row .track{background:rgba(30,58,92,.10);}
    .split{background:var(--border);}`;

for (const [out, bodyFile, theme] of [
  ["Main.dc.html", "body-main.html", DARK],
  ["Light.dc.html", "body-main.html", LIGHT],
  ["Focus.dc.html", "body-focus.html", DARK],
  ["Empty.dc.html", "body-empty.html", DARK],
  ["States.dc.html", "body-states.html", DARK],
]) {
  const body = readFileSync(bodyFile, "utf8").replace("<!--CHROME-->", chrome);
  writeFileSync(out, `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <style>${theme}
${base}
${exec}
  </style>
</helmet>
${body}</x-dc>
</body>
</html>
`);
  console.log("wrote", out);
}
