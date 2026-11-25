import {createContext,useMemo,useRef,type ReactNode} from 'react';
import type {ProjectDocument} from './types';
import {latexCatalogue,prepareLatexCatalogue,type LatexCatalogue} from './latexCompletion';
export const EditorAssistContext=createContext<{spelling:boolean;completions:boolean;catalogue:LatexCatalogue}>({spelling:true,completions:true,catalogue:{citations:[],labels:[],figures:[]}});
export function EditorAssist({document,spelling,completions,children}:{document?:ProjectDocument;spelling:boolean;completions:boolean;children:ReactNode}) {
  const cached=useRef<{key:string;value:LatexCatalogue}|undefined>(undefined);
  const catalogue=useMemo(()=>{
    const value=latexCatalogue(document),key=JSON.stringify(value);
    if(cached.current?.key===key)return cached.current.value;
    cached.current={key,value};return value;
  },[document?.labels,document?.citations,document?.files,document?.nodes]);
  const value=useMemo(()=>{if(completions)prepareLatexCatalogue(catalogue);return {spelling,completions,catalogue};},[spelling,completions,catalogue]);
  return <EditorAssistContext.Provider value={value}>{children}</EditorAssistContext.Provider>;
}
