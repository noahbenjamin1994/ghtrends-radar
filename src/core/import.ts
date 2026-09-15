import {z} from 'zod';
import type {DemandEvidence} from './types.js';
const schema=z.object({keyword:z.string().min(1).max(100),geo:z.string().regex(/^([A-Z]{2})?$/),fetchedAt:z.string().datetime({offset:true}),sourceUrl:z.string().url().refine(s=>new URL(s).hostname==='trends.google.com','Use the original Google Trends source URL.'),points:z.array(z.object({date:z.string().datetime({offset:true}),value:z.number().min(0).max(100),anchor:z.number().min(0).max(100).optional(),partial:z.boolean().optional()})).min(1).max(400),related:z.array(z.object({query:z.string(),value:z.number(),formatted:z.string(),type:z.enum(['top','rising'])})).max(100).default([])});
export function importDemand(input:unknown,keyword:string,geo:string):DemandEvidence {
 const result=schema.safeParse(input);if(!result.success)throw new Error('Invalid Trends evidence: '+result.error.issues.map(i=>i.message).join('; '));
 if(result.data.keyword.toLowerCase()!==keyword.toLowerCase()||result.data.geo!==geo)throw new Error('Invalid Trends evidence: keyword and region must match the requested scan.');
 return result.data;
}
