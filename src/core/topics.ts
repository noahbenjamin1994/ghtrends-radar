import type {Topic} from './types.js';
export const TOPICS:Topic[] = [
  {slug:'mcp-servers',name:'MCP servers',keyword:'mcp servers',query:'topic:mcp-server',description:'The tools connecting AI agents to the real world.',color:'#bcf85e',aliases:['mcp','mcp-server','model context protocol']},
  {slug:'coding-agents',name:'Coding agents',keyword:'coding agent',query:'topic:coding-agent',description:'Agents that navigate, write and ship code.',color:'#79c9ff',aliases:['coding-agent','ai coding','code agent']},
  {slug:'browser-agents',name:'Browser agents',keyword:'browser agent',query:'topic:browser-automation',description:'Software that turns the web into an action space.',color:'#cdadff',aliases:['browser-automation','browser automation']},
  {slug:'agent-memory',name:'Agent memory',keyword:'ai agent memory',query:'topic:agent-memory',description:'Persistent context for agents that learn over time.',color:'#ffbc8b',aliases:['agent memory','memory agent']},
  {slug:'local-llm',name:'Local LLMs',keyword:'local llm',query:'topic:local-llm',description:'Models and inference that run on your own machine.',color:'#f4dc83',aliases:['local llm','local ai']},
  {slug:'vector-databases',name:'Vector databases',keyword:'vector database',query:'topic:vector-database',description:'The retrieval infrastructure behind AI products.',color:'#69d9c3',aliases:['vector database','vector-db']},
  {slug:'voice-agents',name:'Voice agents',keyword:'ai voice agent',query:'topic:voice-agent',description:'Real-time conversations that get things done.',color:'#f19eba',aliases:['voice agent','voice ai']},
  {slug:'rag',name:'Retrieval / RAG',keyword:'retrieval augmented generation',query:'topic:retrieval-augmented-generation',description:'Grounding model answers in useful knowledge.',color:'#a8b9ff',aliases:['retrieval augmented generation','retrieval-augmented-generation']},
];
export function resolveTopic(input:string,keyword?:string):Topic {
  if(keyword!==undefined && (typeof keyword!=='string'||!keyword.trim()||keyword.length>100||/[\x00-\x1f<>]/.test(keyword)))throw new Error('Invalid demand keyword.');
  const value=input.trim().toLowerCase();
  if (!value || value.length>80 || /[\x00-\x1f<>]/.test(value)) throw new Error('Enter a topic between 1 and 80 characters.');
  const found=TOPICS.find(t=>t.slug===value || t.name.toLowerCase()===value || t.aliases.includes(value));
  if(found) return {...found,keyword:keyword?.trim()||found.keyword};
  const slug=value.replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  if(!slug) throw new Error('Use an English GitHub topic or a known category.');
  if(keyword && (keyword.length>100 || /[\x00-\x1f<>]/.test(keyword))) throw new Error('Invalid demand keyword.');
  return {slug,name:input.trim(),keyword:keyword?.trim()||value.replaceAll('-',' '),query:`topic:${slug}`,description:'A custom GitHub topic, paired with Google search interest.',color:'#bcf85e',aliases:[]};
}
export function validateRepo(input:string):string {
  const name=input.replace(/^https:\/\/github\.com\//,'').replace(/\/$/,'');
  if(!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})\/[a-zA-Z0-9._-]{1,100}$/.test(name) || /\/\.{1,2}$/.test(name)) throw new Error('Use a public repository in owner/repo format.');
  return name;
}
export function validateGeo(geo:string):string {
  if(geo!==''&&!/^[A-Z]{2}$/.test(geo)) throw new Error('Region must be a two-letter country code or empty for worldwide.');
  return geo;
}
