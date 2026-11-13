export type ProfileFact=Readonly<{id:string;text:string;sourceId:string;status:'approved'|'pending'|'rejected';stale?:boolean}>
export function selectApprovedProfileFacts(facts:readonly ProfileFact[]){return facts.filter(f=>f.status==='approved'&&!f.stale).map(f=>({id:f.id,text:f.text,sourceId:f.sourceId}))}
