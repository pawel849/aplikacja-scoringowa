"use client";
import { useState } from "react";
import { plLabel } from "@/lib/labels";
export function UrlImport() {
  const [message,setMessage]=useState("");
  return <form onSubmit={async(e)=>{e.preventDefault();setMessage("Analizuję…");const f=new FormData(e.currentTarget);const r=await fetch("/api/import/url",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({url:f.get("url"),name:f.get("name")||undefined})});const j=await r.json();if(r.ok) location.href=`/companies/${j.id}`;else setMessage(j.error?.toString()||"Błąd");}}>
    <label>Nazwa (opcjonalna)</label><input name="name" maxLength={200}/><label>Publiczny URL</label><input name="url" type="url" required placeholder="https://firma.pl"/><button>Dodaj i zbadaj</button><span className="muted">{message}</span>
  </form>;
}
export function CsvImport() {
  const [message,setMessage]=useState("");
  return <form onSubmit={async(e)=>{e.preventDefault();setMessage("Importuję…");const r=await fetch("/api/import/csv",{method:"POST",body:new FormData(e.currentTarget)});const j=await r.json();setMessage(r.ok?`Gotowe: ${j.created} nowych, ${j.checked} sprawdzonych.`:(j.error?.toString()||"Błąd"));}}>
    <input name="file" type="file" accept=".csv,text/csv" required/><button>Importuj CSV</button><span className="muted">{message}</span>
  </form>;
}
export function BatchButton() {
  const [m,setM]=useState(""); return <><button onClick={async()=>{setM("Uruchamiam…");const r=await fetch("/api/research/batch",{method:"POST"});const j=await r.json();setM(r.ok?`Zakończono: ${j.checked} sprawdzonych, ${j.created} nowych.`:`Błąd: ${typeof j.error==="string"?j.error:JSON.stringify(j.error)}`);if(r.ok)location.reload();}}>Nowy batch</button> <span className="muted">{m}</span></>;
}
export function RecheckButton({id}:{id:string}) {
  const [m,setM]=useState(""); return <><button onClick={async()=>{setM("Sprawdzam…");const r=await fetch(`/api/companies/${id}/recheck`,{method:"POST"});setM(r.ok?"Gotowe — odświeżam…":"Błąd");if(r.ok)location.reload();}}>Sprawdź ponownie</button> <span className="muted">{m}</span></>;
}
export function SourceManager({sources}:{sources:Array<{id:string;name:string;enabled:boolean;config:Record<string,string>}>}) {
 const [m,setM]=useState("");
 return <div><form onSubmit={async e=>{e.preventDefault();setM("Zapisuję…");const f=new FormData(e.currentTarget);const r=await fetch("/api/sources",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:f.get("name"),url:f.get("url"),enabled:true})});const j=await r.json();setM(r.ok?"Źródło dodane.":`Błąd: ${typeof j.error==="string"?j.error:JSON.stringify(j.error)}`);if(r.ok)location.reload();}}>
  <label>Nazwa katalogu</label><input name="name" required minLength={2}/><label>Publiczny URL katalogu</label><input name="url" type="url" required/><button>Dodaj katalog</button> <span>{m}</span></form>
  <ul className="source-list">{sources.map(s=><li key={s.id}><label><input type="checkbox" checked={s.enabled} onChange={async e=>{const r=await fetch(`/api/sources/${s.id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({enabled:e.target.checked})});if(!r.ok){const j=await r.json();setM(`Błąd: ${j.error}`);}else location.reload();}}/> <span>{s.name}</span></label>{s.config.url&&<a href={s.config.url} target="_blank" rel="noreferrer">{s.config.url}</a>}</li>)}</ul>
 </div>;
}
export function ManualCorrectionForm({id,company}:{id:string;company:Record<string,unknown>}) {
 const [m,setM]=useState("");
 const list=(key:string)=>(company[key] as string[]||[]).join("\n");
 return <form onSubmit={async e=>{e.preventDefault();setM("Zapisuję…");const f=new FormData(e.currentTarget);
  const nullable=(k:string)=>f.get(k)?.toString().trim()||null, lines=(k:string)=>f.get(k)?.toString().split(/\r?\n/).map(x=>x.trim()).filter(Boolean)||[];
  let decisionMakers,publicJobPostings;try{decisionMakers=JSON.parse(f.get("decisionMakers")?.toString()||"[]");publicJobPostings=JSON.parse(f.get("publicJobPostings")?.toString()||"[]");}catch{setM("Błąd: decydenci i oferty pracy muszą być poprawnym JSON.");return;}
  const reviewRaw=nullable("reviewCount");
  const manual={name:nullable("name"),website:nullable("website"),country:nullable("country"),region:nullable("region"),city:nullable("city"),phone:nullable("phone"),publicEmail:nullable("publicEmail"),nip:nullable("nip"),krs:nullable("krs"),technologies:lines("technologies"),partnershipLevels:lines("partnershipLevels"),serviceDescription:nullable("serviceDescription"),portfolioUrls:lines("portfolioUrls"),reviewCount:reviewRaw===null?null:Number(reviewRaw),reviewSource:nullable("reviewSource"),decisionMakers,publicJobPostings};
  const r=await fetch(`/api/companies/${id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({manual})}),j=await r.json();setM(r.ok?"Zapisano ręczne korekty.":`Błąd: ${typeof j.error==="string"?j.error:JSON.stringify(j.error)}`);if(r.ok)location.reload();
 }}><p className="muted">Zapisane pola stają się ręcznymi nadpisaniami i kolejny research ich nie zmieni. Źródła i dowody publiczne pozostają oddzielne.</p>
 <label>Nazwa</label><input name="name" required defaultValue={String(company.name||"")}/><label>WWW</label><input name="website" type="url" defaultValue={String(company.website||"")}/>
 <div className="grid"><div><label>Kraj</label><input name="country" required defaultValue={String(company.country||"PL")}/><label>Region</label><input name="region" defaultValue={String(company.region||"")}/><label>Miasto</label><input name="city" defaultValue={String(company.city||"")}/></div>
 <div><label>Telefon</label><input name="phone" defaultValue={String(company.phone||"")}/><label>Publiczny e-mail</label><input name="publicEmail" type="email" defaultValue={String(company.public_email||"")}/><label>NIP</label><input name="nip" defaultValue={String(company.nip||"")}/><label>KRS</label><input name="krs" defaultValue={String(company.krs||"")}/></div></div>
 <label>Technologie (jedna na linię)</label><textarea name="technologies" defaultValue={list("technologies")}/><label>Poziomy partnerstwa (jeden na linię)</label><textarea name="partnershipLevels" defaultValue={list("partnership_levels")}/>
 <label>Opis usług</label><textarea name="serviceDescription" defaultValue={String(company.service_description||"")}/><label>Portfolio URL (jeden na linię)</label><textarea name="portfolioUrls" defaultValue={list("portfolio_urls")}/>
 <label>Liczba opinii</label><input name="reviewCount" type="number" min="0" defaultValue={company.review_count==null?"":String(company.review_count)}/><label>Źródło opinii</label><input name="reviewSource" defaultValue={String(company.review_source||"")}/>
 <label>Decydenci (JSON: name, role, sourceUrl)</label><textarea name="decisionMakers" defaultValue={JSON.stringify(company.decision_makers||[],null,2)}/><label>Oferty pracy (JSON: title, url, date)</label><textarea name="publicJobPostings" defaultValue={JSON.stringify(company.public_job_postings||[],null,2)}/>
 <button>Zapisz korekty ręczne</button> <span>{m}</span></form>;
}
export function QualificationForm({id,company,answers}:{id:string;company:Record<string,string|null>;answers:Record<string,string|null>}) {
 const [m,setM]=useState(""); const fields=[["wantsMoreProjects","Czy chce więcej projektów?","wants_more_projects"],["capacityHiringPlan","Moce / plan zatrudnienia","capacity_hiring_plan"],["inquiryOwner","Kto obsługuje i domyka zapytania?","inquiry_owner"],["ownerBottleneck","Czy właściciel jest wąskim gardłem?","owner_bottleneck"],["desiredJobs","Pożądane zlecenia","desired_jobs"],["avoidedJobs","Unikane zlecenia","avoided_jobs"]];
 return <form onSubmit={async(e)=>{e.preventDefault();const f=new FormData(e.currentTarget),a=Object.fromEntries(fields.map(x=>[x[0],f.get(x[0])?.toString()]));const r=await fetch(`/api/companies/${id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({notes:f.get("notes"),contactStatus:f.get("contactStatus"),qualificationFinalStatus:f.get("qualificationFinalStatus"),answers:a})});const j=await r.json();setM(r.ok?"Zapisano.":j.error?.toString()||"Nie zapisano.");}}>
  <label>Status kontaktu</label><select name="contactStatus" defaultValue={company.contact_status||"NEW"}>{["NEW","TO_CONTACT","CONTACTED","PAUSED","CLOSED"].map(x=><option key={x} value={x}>{plLabel(x)}</option>)}</select>
  {fields.map(([name,label,db])=><div key={name}><label>{label}</label><textarea name={name} defaultValue={answers[db]||""}/></div>)}
  <label>Końcowy status kwalifikacji</label><select name="qualificationFinalStatus" defaultValue={company.qualification_final_status||"UNQUALIFIED"}>{["UNQUALIFIED","NEEDS_RESEARCH","ICP_CONFIRMED","DISQUALIFIED"].map(x=><option key={x} value={x}>{plLabel(x)}</option>)}</select>
  <p className="muted">ICP_CONFIRMED i DISQUALIFIED są dozwolone wyłącznie po ręcznym zapisaniu min. 3 odpowiedzi z rozmowy.</p>
  <label>Notatki</label><textarea name="notes" rows={5} defaultValue={company.notes||""}/><button>Zapisz kwalifikację</button> <span>{m}</span>
 </form>;
}
