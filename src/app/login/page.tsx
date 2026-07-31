export default async function Login({searchParams}:{searchParams:Promise<{next?:string;error?:string}>}) {
 const p=await searchParams;
 return <main><section className="card" style={{maxWidth:440,margin:"10vh auto"}}><h1>Logowanie wewnętrzne</h1>{p.error&&<p className="error">Nieprawidłowe hasło.</p>}<form action="/api/login" method="post"><input type="hidden" name="next" value={p.next||"/"}/><label>Hasło aplikacji</label><input name="password" type="password" required autoFocus/><button>Zaloguj</button></form></section></main>;
}
