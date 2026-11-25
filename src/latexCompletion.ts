import type { ProjectDocument } from './types.ts';

export interface LatexOption { value:string; detail:string }
export interface LatexCatalogue { citations:LatexOption[]; labels:LatexOption[]; figures:LatexOption[] }
export interface LatexCompletion { source:string; start:number; end:number; close:string; options:LatexOption[] }
// Catalogues are immutable document snapshots. Retain only their small search
// index; obsolete arrays and their indexes can be garbage-collected together.
const indexes=new WeakMap<LatexOption[],Array<{option:LatexOption;key:string;search:string}>>();
function completionIndex(items:LatexOption[]) {
  let index=indexes.get(items);if(index)return index;
  index=items.map(option=>({option,key:option.value.toLowerCase(),search:`${option.value} ${option.detail}`.toLowerCase()})).sort((a,b)=>a.option.value.localeCompare(b.option.value));
  indexes.set(items,index);return index;
}
export function prepareLatexCatalogue(catalogue:LatexCatalogue) {
  for(const items of [catalogue.citations,catalogue.labels,catalogue.figures])completionIndex(items);
}
const safe=(s:string)=>s.length>0&&s.length<1000&&!/[{}\r\n]/.test(s);
export function latexCatalogue(document?:ProjectDocument):LatexCatalogue {
  const unique=(items:LatexOption[])=>[...new Map(items.filter(i=>safe(i.value)).map(i=>[i.value,i])).values()];
  const titles=new Map(document?.nodes.map(n=>[n.id,n.title])??[]);
  return {
    citations:unique((document?.citations??[]).map(c=>({value:c.key,detail:[c.author,c.year,c.title].filter(Boolean).join(' · ')}))),
    labels:unique((document?.labels??[]).map(l=>({value:l.key,detail:[titles.get(l.nodeId),l.file].filter(Boolean).join(' · ')}))),
    figures:unique((document?.files??[]).filter(f=>/\.(png|jpe?g|pdf|svg|eps|webp)$/i.test(f)).map(f=>({value:f,detail:'Project figure'}))),
  };
}
/** Complete only a real, unfinished argument at the caret. Never guess keys. */
export function latexCompletion(source:string,caret:number,catalogue:LatexCatalogue):LatexCompletion|undefined {
  if(!Number.isInteger(caret)||caret<0||caret>source.length)return;
  const before=source.slice(0,caret),match=/\\(cite[a-zA-Z]*|parencite|textcite|autocite|footcite|[a-zA-Z]*ref|includegraphics)\*?(?:\[[^\]\n]*\]){0,2}\{([^{}\n]*)$/.exec(before);
  if(!match)return;
  let escapes=0;for(let i=match.index-1;i>=0&&source[i]==='\\';i--)escapes++;
  if(escapes%2)return;
  // Ignore a commented-out command on this line, preserving escaped percent.
  if(/(^|[^\\])%/.test(before.slice(before.lastIndexOf('\n')+1,match.index)))return;
  const command=match[1],argument=match[2],isFigure=command==='includegraphics';
  const fragment=isFigure?argument:argument.slice(argument.lastIndexOf(',')+1);
  const prefix=fragment.trimStart(),query=prefix.toLowerCase();
  const items=isFigure?catalogue.figures:command.endsWith('ref')?catalogue.labels:catalogue.citations;
  const index=completionIndex(items),preferred:LatexOption[]=[],other:LatexOption[]=[];
  for(const item of index) {
    if(item.key.startsWith(query))preferred.push(item.option);
    else if(other.length<8&&item.search.includes(query))other.push(item.option);
    if(preferred.length===8)break;
  }
  const options=[...preferred,...other].slice(0,8);
  if(!options.length)return;
  const start=caret-prefix.length,end=caret+(source.slice(caret).match(/^[^},\s]*/)?.[0].length??0);
  return {source,start,end,close:/^[},]/.test(source.slice(end))?'':'}',options};
}
export function acceptLatexCompletion(source:string,match:LatexCompletion,value:string) {
  if(source!==match.source||!match.options.some(option=>option.value===value))return;
  const inserted=value+match.close;
  return {text:source.slice(0,match.start)+inserted+source.slice(match.end),caret:match.start+inserted.length};
}

/** Spelling decoration only. Concatenating the segments always returns the
 * exact source, including incomplete math. It does not validate mathematics. */
export function latexSpellingSegments(source:string):Array<{text:string;check:boolean}> {
  const skip=/\\begin\{(equation|align|alignat|gather|multline|flalign|eqnarray|displaymath|math)\*?\}[\s\S]*?\\end\{\1\*?\}|\\\[[\s\S]*?(?:\\\]|$)|\\\([\s\S]*?(?:\\\)|$)|\$\$[\s\S]*?(?:\$\$|$)|\$(?:\\.|[^$])*?(?:\$|$)|\\(?:cite[a-zA-Z]*|parencite|textcite|autocite|footcite|[a-zA-Z]*ref|label|includegraphics|url|href|path)\*?(?:\[[^\]\n]*\]){0,2}\{[^}]*\}|\\(?:begin|end)\{[^}]*\}|\\[a-zA-Z@]+\*?|\\[^a-zA-Z]|%[^\n]*/g;
  const result:Array<{text:string;check:boolean}>=[];let at=0;
  for(const match of source.matchAll(skip)) {if(match.index>at)result.push({text:source.slice(at,match.index),check:true});result.push({text:match[0],check:false});at=match.index+match[0].length;}
  if(at<source.length)result.push({text:source.slice(at),check:true});return result;
}
