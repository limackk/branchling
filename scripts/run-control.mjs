#!/usr/bin/env node
/** Inspect and control locally supervised detached runs (TL-359). */
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { listExecutionRecords, readExecutionRecord, updateRunRecord } from "./execution-records.mjs";
import { resolveBacklogDir } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { printJson } from "./json-envelope.mjs";
import { failure } from "./ui.mjs";
const HERE = dirname(fileURLToPath(import.meta.url));
function parse(args) { const p = { action: null, id: null, dir: null, json: false, timeout: 30 }; for (let i=0;i<args.length;i++) { const a=args[i]; if(a==="--json")p.json=true; else if(a==="--dir"||a==="--timeout"){const v=args[++i];if(!v)throw Error("`"+a+"` with no value");p[a.slice(2)]=a==="--timeout"?Number(v):v;} else if(!a.startsWith("-")&&!p.action)p.action=a; else if(!a.startsWith("-")&&!p.id)p.id=a; else throw Error("unexpected argument: "+a); } if(!["list","show","wait","cancel"].includes(p.action))throw Error("use list, show, wait or cancel"); if(p.action!=="list"&&!p.id)throw Error("which run id?"); return p; }
function alive(record) { const pid=record&&record.supervisor&&record.supervisor.pid; if(!Number.isInteger(pid)||pid<1)return false; const probe=spawnSync("ps",["-p",String(pid),"-o","command="],{encoding:"utf8"}); return probe.status===0&&String(probe.stdout).includes("run-loop.mjs"); }
const TERMINAL = ["finished", "cancelled", "interrupted"];
function reconcile(root, record) {
  if (record && record.kind === "run" && !TERMINAL.includes(record.phase) && !alive(record)) {
    updateRunRecord(root, record, { phase: "interrupted", outcome: "supervisor-exited", finishedAt: new Date().toISOString() });
  }
  return record;
}
async function main(argv) { let p;try{p=parse(argv);}catch(e){console.error(failure(N+" runs",e.message,[],[N+" runs --help"]));return 2;} const root=resolveBacklogDir({dir:p.dir||undefined,moduleDir:HERE}).root; const one=()=>reconcile(root,readExecutionRecord(root,p.id)); if(p.action==="list"){const runs=listExecutionRecords(root).filter(r=>r.kind==="run").map(r=>reconcile(root,r));if(p.json)printJson("runs",{runs});else console.log(runs.map(r=>r.id+"  "+r.phase).join("\n")||"no local runs");return 0;} let r=one();if(!r){if(p.json)printJson("run",{run:null,alive:null});else console.error(failure(N+" runs","no such local run: "+p.id,[]));return 1;} if(p.action==="wait"){const until=Date.now()+p.timeout*1000;while(!TERMINAL.includes(r.phase)&&Date.now()<until){await new Promise(x=>setTimeout(x,200));r=one()||r;} } if(p.action==="cancel"&&!TERMINAL.includes(r.phase)){if(!alive(r)){updateRunRecord(root,r,{phase:"interrupted",outcome:"stale-supervisor",finishedAt:new Date().toISOString()});}else{try{process.kill(-r.supervisor.pid,"SIGTERM");}catch{process.kill(r.supervisor.pid,"SIGTERM");}updateRunRecord(root,r,{phase:"cancelled",outcome:"cancelled",finishedAt:new Date().toISOString()});}} if(p.json)printJson("run",{run:r,alive:alive(r)});else console.log(r.id+"  "+r.phase+(alive(r)?"  alive":""));return 0; }
if(process.argv[1]&&process.argv[1].endsWith("run-control.mjs"))main(process.argv.slice(2)).then(code=>process.exit(code));
