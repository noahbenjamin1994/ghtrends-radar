// Synthetic account UI for browser QA; no identity, payment or research calls.
import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "vite";
import react from "@vitejs/plugin-react";

const root = resolve(import.meta.dirname, "..");
const scratch = await realpath(
  await mkdtemp(join(tmpdir(), "ghtrends-account-ui-")),
);
const bootstrap = `
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const lot = {lot_id:uuid(1),transaction_id:uuid(2),granted:10,available:7,reserved:1,used:2,revoked:0,expires_at:'2026-12-17T13:00:00Z',expired:false,expired_unused:0};
const expired = {...lot,lot_id:uuid(3),transaction_id:uuid(4),granted:3,available:0,reserved:0,used:0,expired:true,expired_unused:3,expires_at:'2026-09-17T13:00:00Z'};
const order = (id, batch) => ({id:uuid(id),order_number:'cp_qa_example_'+id,name:'Research pack',created_at:'2026-09-18T13:00:00Z',paid_at:'2026-09-18T13:01:00Z',status:'paid',amount_minor:2189,currency:'USD',amount_kind:'paid_total',units:batch.granted,lot:batch});
const activity = [
 ['pack_reserve',-1,7],['pack_settle',0,8],['pack_reserve',-1,8],['pack_release',1,9],['pack_reserve',-1,8],['pack_settle',0,9],['pack_reserve',-1,9],['pack_grant',10,10],['pack_expire',-3,0],['pack_grant',3,3]
].map(([reason,delta,balance_after],i)=>({id:uuid(20+i),created_at:new Date(Date.UTC(2026,8,18,13,10-i)).toISOString(),reason,delta,balance_after,attempt:reason.includes('grant')||reason.includes('expire')?null:1,researchId:reason==='pack_settle'?uuid(50):null}));
window.__qa={mode:new URL(location.href).searchParams.get('mode')||'ready',calls:[]};
window.fetch=async(url)=>{
 const path=String(url);window.__qa.calls.push(path);
 if(window.__qa.mode==='unavailable')return Response.json({state:'unavailable',error:'Account syncing'},{status:503});
 if(window.__qa.mode==='off')return Response.json({state:'off'});
 const older=path.includes('activity_cursor');
 return Response.json({state:'ready',syncedAt:new Date().toISOString(),data:{balance:{available:7,reserved:1,used:2,lots:[lot,expired]},purchases:[order(2,lot),order(4,expired)],purchase_next:null,activity:older?activity.slice(4):activity.slice(0,4),activity_next:older?null:uuid(23)}});
};
const account={hosted:true,engagementEnabled:false,authAvailable:true,aiAvailable:true,user:{name:'Researcher',isAdmin:false},csrf:'qa',dailyLimit:1,used:0,quota:{limit:1,used:0,remaining:1,resetAt:'2026-09-19T00:00:00Z'},trends:{retryAt:null},deep:{enabled:true,allowance:{limit:1,remaining:0,reserved:0,used:1}}};
`;
await writeFile(
  join(scratch, "entry.jsx"),
  `${bootstrap}
import React from 'react'; import {createRoot} from 'react-dom/client';
import {AccountView} from '${join(root, "src/web/credits.tsx")}';
import '${join(root, "node_modules/@fontsource-variable/archivo/index.css")}';
import '${join(root, "src/web/style.css")}';
createRoot(document.getElementById('root')).render(<div className="app-shell"><main><AccountView account={account}/></main></div>);`,
);
await writeFile(
  join(scratch, "index.html"),
  `<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Account · isolated QA</title><script>document.documentElement.lang=new URL(location.href).searchParams.get('lang')==='en'?'en':'zh';</script></head><body><div id="root"></div><script type="module" src="${join(scratch, "entry.jsx")}"></script></body></html>`,
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
