import {test} from 'node:test';
import assert from 'node:assert/strict';
import {analyze,demandMetrics} from '../src/core/analyze.js';
import {TOPICS,validateRepo,resolveTopic} from '../src/core/topics.js';
import type {DemandEvidence,SupplyEvidence} from '../src/core/types.js';
const asOf='2026-09-15T12:00:00.000Z';
function demand(mode:'growing'|'flat'|'spike'|'zero'|'seasonal'='flat'):DemandEvidence {
  const values=Array.from({length:104},()=>20);
  if(mode==='growing'||mode==='seasonal')for(let i=96;i<104;i++)values[i]=40;
  if(mode==='seasonal')for(let i=44;i<52;i++)values[i]=40;
  if(mode==='spike')values[103]=100;
  if(mode==='zero')values.fill(0);
  return {keyword:'test',geo:'',fetchedAt:asOf,sourceUrl:'https://trends.google.com',related:[],points:values.map((value,i)=>({date:new Date(Date.parse('2026-09-06T00:00:00Z')-(103-i)*7*86400000).toISOString(),value,anchor:10}))};
}
function supply(n:number):SupplyEvidence{return{query:'topic:test',sourceUrl:'https://github.com/search',fetchedAt:asOf,total:n,complete:true,repositories:[]};}
for(const[kind,n,mode]of [['blue',12,'growing'],['expanding',150,'growing'],['contested',150,'flat'],['quiet',12,'flat']] as const){test(`classifies ${kind} from independent supply and demand`,()=>assert.equal(analyze(TOPICS[0]!,demand(mode),supply(n),[],asOf).kind,kind));}
test('one viral search spike cannot manufacture a blue ocean',()=>assert.equal(analyze(TOPICS[0]!,demand('spike'),supply(10),[],asOf).kind,'quiet'));
test('annual seasonal rebound is not a breakout',()=>{const m=analyze(TOPICS[0]!,demand('seasonal'),supply(10),[],asOf);assert.equal(m.metrics.seasonal,true);assert.equal(m.kind,'quiet');});
test('zero search values mean insufficient evidence, never a dead market',()=>{const m=analyze(TOPICS[0]!,demand('zero'),supply(0),[],asOf);assert.equal(m.kind,'uncertain');assert.equal(m.score,null);assert.equal(m.metrics.growth,null);});
test('missing and stale sources cannot earn confident classifications',()=>{const d=demand('growing');d.fetchedAt='2026-08-01';assert.equal(analyze(TOPICS[0]!,d,supply(10),[],asOf).kind,'uncertain');const s=supply(5);s.complete=false;assert.equal(analyze(TOPICS[0]!,demand('growing'),s,[],asOf).kind,'uncertain');});
test('partial, duplicate and future observations do not inflate evidence',()=>{const d=demand();d.points=[...d.points,...d.points,{date:'2027-01-01',value:100},{date:'2026-09-13',value:100,partial:true}];assert.equal(demandMetrics(d,asOf).points,104);});
test('result identity includes evidence and is deterministic',()=>{const a=analyze(TOPICS[0]!,demand(),supply(10),[],asOf),b=analyze(TOPICS[0]!,demand(),supply(10),[],asOf),c=analyze(TOPICS[0]!,demand(),supply(11),[],asOf);assert.equal(a.id,b.id);assert.notEqual(a.id,c.id);});
test('repo and keyword boundaries reject unsafe input',()=>{for(const n of ['../../etc/passwd','owner/repo?token=secret','https://evil.test/o/r','owner/..'])assert.throws(()=>validateRepo(n));assert.equal(validateRepo('https://github.com/facebook/react'),'facebook/react');assert.throws(()=>resolveTopic('<script>'));});
test('daily or missing-week data cannot be mistaken for weekly demand',()=>{const d=demand('growing');d.points.splice(60,1);assert.equal(analyze(TOPICS[0]!,d,supply(10),[],asOf).kind,'uncertain');const daily=demand('growing');daily.points=daily.points.map((p,i)=>({...p,date:new Date(Date.parse(asOf)-(104-i)*86400000).toISOString()}));assert.equal(demandMetrics(daily,asOf).fast,null);});
test('keyword overrides are validated for curated categories too',()=>assert.throws(()=>resolveTopic('mcp','<script>')));
