import { mimeText, type ExperimentCell } from "./experiments.ts";
export function savedImageSize(cell:ExperimentCell) {
  let count=0,bytes=0;
  for(const output of cell.outputs ?? []){
    const png=mimeText(output.data?.["image/png"]);if(!png)continue;
    const base64=png.replace(/\s/g,"");count++;bytes+=Math.max(0,Math.floor(base64.length*3/4)-(base64.endsWith("==")?2:base64.endsWith("=")?1:0));
  }
  return {count,bytes};
}
export function removeCellImages(cell:ExperimentCell):ExperimentCell {
  if(!savedImageSize(cell).count)return cell;
  return {...cell,outputs:cell.outputs?.map(output=>{
    if(!output.data || !("image/png" in output.data))return output;
    const data={...output.data};delete data["image/png"];return {...output,data};
  }),metadata:{...cell.metadata,paperfocus:{...cell.metadata.paperfocus,imagesCleared:true}}};
}
/** Never let image undo overwrite new run results, output edits or another cell. */
export function restoreCellImages(cell:ExperimentCell,original:ExperimentCell):ExperimentCell {
  const removed=removeCellImages(original);
  if(cell.id!==original.id || cell.metadata.paperfocus?.runId!==original.metadata.paperfocus?.runId || JSON.stringify(cell.outputs)!==JSON.stringify(removed.outputs))throw new Error("Outputs changed since image removal. Use the saved run or notebook copy instead.");
  return {...cell,outputs:original.outputs,metadata:{...cell.metadata,paperfocus:{...cell.metadata.paperfocus,imagesCleared:original.metadata.paperfocus?.imagesCleared}}};
}
export function imageSizeLabel(bytes:number){return bytes>=1_000_000?`${(bytes/1_000_000).toFixed(1)} MB`:`${Math.ceil(bytes/1000)} KB`;}
