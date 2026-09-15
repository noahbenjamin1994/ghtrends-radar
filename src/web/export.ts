import type {Market} from '../core/types.js';
import {marketCard} from '../core/card.js';
export async function downloadCard(m:Market,url:string){
 const svg=marketCard(m,url);
 const source=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
 const image=new Image();await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(new Error('Image export failed.'));image.src=source;});
 const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=630;canvas.getContext('2d')!.drawImage(image,0,0);URL.revokeObjectURL(source);
 const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)return;
 const link=document.createElement('a');const png=URL.createObjectURL(blob);link.href=png;link.download=`ghtrends-${m.topic.slug}.png`;link.click();setTimeout(()=>URL.revokeObjectURL(png),1000);
}
