export interface CorpusEntry { key: string; title: string; file: string; projectId?: string }
export interface CorpusProfile { name: string; hidden: string[] }
export interface ResearchCorpus { version: 1; mainFile: string; activeProfile: string; entries: CorpusEntry[]; profiles: Record<string, CorpusProfile> }
export interface CorpusSnapshot { corpus: ResearchCorpus; revision: string }
export type CorpusAction = { action: "visibility"; key: string; visible: boolean } | { action: "profile"; profile: string; name?: string };
