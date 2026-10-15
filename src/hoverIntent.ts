/** Ignore pointer fly-bys; cancellation also prevents stale/unmounted reveals. */
export const hoverRevealDelayMs = 250;
export function createHoverIntent(reveal:()=>void, clock:{set:(callback:()=>void,delay:number)=>unknown;clear:(handle:unknown)=>void} = {
  set:(callback,delay)=>setTimeout(callback,delay),clear:handle=>clearTimeout(handle as ReturnType<typeof setTimeout>),
}) {
  let timer:unknown;
  const cancel=()=>{if(timer!==undefined)clock.clear(timer);timer=undefined;};
  return {
    enter(){if(timer!==undefined)return;timer=clock.set(()=>{timer=undefined;reveal();},hoverRevealDelayMs);},
    cancel,
  };
}
