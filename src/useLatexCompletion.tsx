import {useContext,useId,useState,type KeyboardEvent,type RefObject} from 'react';
import {createPortal} from 'react-dom';
import {EditorAssistContext} from './EditorAssist';
import {acceptLatexCompletion,latexCompletion,type LatexCompletion} from './latexCompletion';
import {editableCaret,editableText,editableRangeAt} from './editableText';

export function useLatexCompletion(root:RefObject<HTMLParagraphElement|null>,editable:boolean,commit:(text:string,caret:number)=>void) {
  const assist=useContext(EditorAssistContext),id=useId();
  const [match,setMatch]=useState<(LatexCompletion&{left:number;top:number})>(),[active,setActive]=useState(0);
  const close=()=>setMatch(undefined);
  const refresh=(sample?:{source:string;caret:number})=>{
    const field=root.current,selection=window.getSelection();
    if(!editable||!assist.completions||!field||window.document.activeElement!==field||!selection?.isCollapsed){close();return;}
    const caret=sample?.caret??editableCaret(field),source=sample?.source??editableText(field),next=caret===undefined?undefined:latexCompletion(source,caret,assist.catalogue);
    if(!next){close();return;}
    const rect=editableRangeAt(field,caret!).getBoundingClientRect(),fallback=field.getBoundingClientRect();
    setMatch({...next,left:Math.max(8,Math.min(rect.width||rect.height?rect.left:fallback.left,window.innerWidth-328)),top:Math.max(8,Math.min((rect.height?rect.bottom:fallback.top)+5,window.innerHeight-230))});setActive(0);
  };
  const accept=(index:number)=>{const field=root.current,option=match?.options[index];if(field&&match&&option){const next=acceptLatexCompletion(editableText(field),match,option.value);if(next)commit(next.text,next.caret);}close();};
  const keyDown=(event:KeyboardEvent<HTMLElement>)=>{
    if(event.nativeEvent.isComposing)return false;
    if(event.ctrlKey&&!event.altKey&&!event.metaKey&&event.code==='Space'){event.preventDefault();refresh();return true;}
    if(!match||event.ctrlKey||event.metaKey||event.altKey)return false;
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setActive(i=>(i+(event.key==='ArrowDown'?1:-1)+match.options.length)%match.options.length);return true;}
    if(event.key==='Enter'||event.key==='Tab'){event.preventDefault();accept(active);return true;}
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();return true;}return false;
  };
  const panel=match?createPortal(<div id={id} role="listbox" aria-label="LaTeX suggestions" className="latex-completion" style={{left:match.left,top:match.top}} onMouseDown={event=>event.preventDefault()}>
    {match.options.map((option,index)=><button id={`${id}-${index}`} key={option.value} role="option" aria-selected={index===active} onClick={()=>accept(index)}><strong>{option.value}</strong>{option.detail&&<small>{option.detail}</small>}</button>)}<footer>↑ ↓ choose · Enter or Tab insert · Esc close</footer>
  </div>,window.document.body):null;
  return {refresh,close,keyDown,panel,spelling:assist.spelling,open:Boolean(match),listId:id,activeId:`${id}-${active}`};
}
