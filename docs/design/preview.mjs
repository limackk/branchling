import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
const files = readdirSync(".").filter((f) => f.endsWith(".dc.html"));
createServer((req, res) => {
  const name = decodeURIComponent(req.url.slice(1)) || files[0];
  if (!files.includes(name)) { res.writeHead(404).end("no"); return; }
  const src = readFileSync(name, "utf8");
  const style = src.slice(src.indexOf("<style>"), src.indexOf("</style>") + 8);
  const body = src.slice(src.indexOf("</helmet>") + 9, src.indexOf("</x-dc>"));
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><meta charset="utf-8">${style}<div style="width:1440px">${body}</div>`);
}).listen(4848, "127.0.0.1", () => console.log("preview on 4848", files.join(" ")));
