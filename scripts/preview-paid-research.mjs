// Synthetic paid-research UI; provider calls, account identity and money stay simulated.
import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "vite";
import react from "@vitejs/plugin-react";

const root = resolve(import.meta.dirname, ".."),
  scratch = await realpath(await mkdtemp(join(tmpdir(), "ghtrends-paid-ui-")));
const bootstrap = `
const id='00000000-0000-4000-8000-000000000050';
const params=new URL(location.href).searchParams;
window.__qa={mode:params.get('mode')||'ready',calls:[]};
const account={hosted:true,engagementEnabled:false,authAvailable:true,aiAvailable:true,user:{name:'Researcher',isAdmin:false},csrf:'qa',dailyLimit:1,used:0,quota:{limit:1,used:0,remaining:1,resetAt:'2026-09-19T00:00:00Z'},trends:{retryAt:null},deep:{enabled:true,paidAvailable:true,paidDailyAttempts:10,allowance:{limit:1,remaining:0,reserved:0,used:1}}};
const task={id,title:{en:'Help teams review document comments',zh:'帮团队整理文档评审意见'},request:{reportId:'aaaaaaaaaaaaaaaa',directionId:'comments',question:'scope',context:''},geo:'US',model:'qa',version:'3',created:'2026-09-18T13:00:00Z',updated:'2026-09-18T13:02:00Z',attempts:1,funding:'pack',state:'partial',stage:'partial',credit:'returned',problem:'model'};
if(window.__qa.mode==='settling')task.credit='settling';
if(window.__qa.mode==='queued'){task.state=task.stage='queued';task.credit='checking';}
window.fetch=async(url,options={})=>{
 const path=String(url);window.__qa.calls.push({path,method:options.method||'GET',body:options.body?JSON.parse(options.body):null});
 if(path.startsWith('/api/account/credits')) {
  if(window.__qa.mode==='unavailable')return Response.json({state:'unavailable',error:'Account syncing'},{status:503});
  return Response.json({state:'ready',syncedAt:new Date().toISOString(),data:{balance:{available:window.__qa.mode==='empty'?0:7,reserved:0,used:3,lots:[]},purchases:[],purchase_next:null,activity:[],activity_next:null}});
 }
 if(path==='/api/account')return Response.json(account);
 if(path.includes('/retry')){task.state=task.stage='queued';task.credit='checking';task.attempts++;return Response.json(task);}
 if(path.includes('/cancel')){task.state=task.stage='partial';task.credit='uncharged';task.problem='interrupted';return Response.json(task);}
 if(options.method==='POST'){sessionStorage.setItem('qa-paid-start',options.body);return Response.json(task);}
 return Response.json(task);
};
`;
await writeFile(
  join(scratch, "entry.jsx"),
  `${bootstrap}
import React from 'react';import {createRoot} from 'react-dom/client';
import {DeepStart,DeepResearchView} from '${join(root, "src/web/deep.tsx")}';
import '${join(root, "node_modules/@fontsource-variable/archivo/index.css")}';
import '${join(root, "src/web/style.css")}';
createRoot(document.getElementById('root')).render(<div className="app-shell"><main>{location.pathname.includes('/research/')?<DeepResearchView id={id} account={account}/>:<section className="panel"><h1>ghtrends · {document.documentElement.lang==='zh'?'专项研究':'Focused research'}</h1><DeepStart reportId="aaaaaaaaaaaaaaaa" directionId="comments"/></section>}</main></div>);`,
);
await writeFile(
  join(scratch, "index.html"),
  `<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Paid research · isolated QA</title><script>document.documentElement.lang=new URL(location.href).searchParams.get('lang')==='en'?'en':'zh';</script></head><body><div id="root"></div><script type="module" src="${join(scratch, "entry.jsx")}"></script></body></html>`,
);
await build({
  root: scratch,
  configFile: false,
  plugins: [react()],
  resolve: {
    alias: {
      react: join(root, "node_modules/react"),
      "react-dom": join(root, "node_modules/react-dom"),
    },
  },
  build: { outDir: join(scratch, "dist"), emptyOutDir: true },
});
console.log("QA output: " + join(scratch, "dist"));
