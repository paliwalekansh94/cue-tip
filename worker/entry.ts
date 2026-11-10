// Protected staff identity endpoints. No billing mutations are exposed here.
interface Env { DB:D1Database; ASSETS:Fetcher; STAFF_PIN_PEPPER?:string; STAFF_BOOTSTRAP_SECRET?:string }
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers});
const encoder=new TextEncoder();
const hex=(b:ArrayBuffer)=>Array.from(new Uint8Array(b)).map(v=>v.toString(16).padStart(2,'0')).join('');
const randomHex=(n:number)=>{const b=new Uint8Array(n);crypto.getRandomValues(b);return Array.from(b).map(v=>v.toString(16).padStart(2,'0')).join('')};
async function hashToken(s:string){return hex(await crypto.subtle.digest('SHA-256',encoder.encode(s)))}
async function pinHash(pin:string,salt:string,pepper:string){const key=await crypto.subtle.importKey('raw',encoder.encode(pin+':'+pepper),'PBKDF2',false,['deriveBits']);return hex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:encoder.encode(salt),iterations:100000,hash:'SHA-256'},key,256))}
const same=(a:string,b:string)=>{if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0};
const cookie=(token:string,maxAge:number)=>'cue_tip_staff='+token+'; HttpOnly; Secure; SameSite=Strict; Path=/api/staff; Max-Age='+maxAge;
const readCookie=(req:Request)=>req.headers.get('Cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith('cue_tip_staff='))?.slice('cue_tip_staff='.length)??'';
async function user(req:Request,env:Env){const token=readCookie(req);if(!/^[0-9a-f]{64}$/.test(token))return null;return env.DB.prepare('SELECT u.id,u.username FROM staff_sessions s JOIN staff_users u ON u.id=s.staff_id WHERE s.token_hash=? AND s.expires_at>? AND u.enabled=1').bind(await hashToken(token),Date.now()).first<{id:number;username:string}>()}
async function body(req:Request){try{return await req.json() as Record<string,unknown>}catch{return {}}}
const validPin=(x:unknown):x is string=>typeof x==='string'&&/^\d{6,10}$/.test(x);
const validName=(x:unknown):x is string=>typeof x==='string'&&/^[a-zA-Z][a-zA-Z0-9_-]{2,31}$/.test(x);
export default {
 async fetch(req:Request,env:Env):Promise<Response>{
  const url=new URL(req.url),path=url.pathname;
  if(path==='/api/health'){if(req.method!=='GET')return reply({error:'Method not allowed'},405);try{await env.DB.prepare('SELECT 1 FROM stations LIMIT 1').first();return reply({ok:true,database:'connected'})}catch{return reply({ok:false,database:'unavailable'},503)}}
  if(!path.startsWith('/api/'))return env.ASSETS.fetch(req);
  if(!env.DB)return reply({error:'Database unavailable'},503);
  if(path==='/api/public/rankings'&&req.method==='GET'){
   const kind=url.searchParams.get('kind');if(kind!=='Snooker'&&kind!=='Pool')return reply({error:'Invalid category'},400);
   // The current schema has no station linkage on matches. Do not fabricate category rankings.
   return reply({kind,players:[],message:'Verified public category rankings are not yet connected to D1 match records.'});
  }
  if(!path.startsWith('/api/staff/'))return reply({error:'Not found'},404);
  if(req.method==='POST'&&req.headers.get('Origin')!==url.origin)return reply({error:'Origin mismatch'},403);
  if(path==='/api/staff/me'&&req.method==='GET'){const staff=await user(req,env);return staff?reply({authenticated:true,staff}):reply({authenticated:false},401)}
  if(path==='/api/staff/bootstrap'&&req.method==='POST'){
   if(!env.STAFF_BOOTSTRAP_SECRET||!env.STAFF_PIN_PEPPER)return reply({error:'Staff setup not configured'},503);
   const b=await body(req);if(!validName(b.username)||!validPin(b.pin)||typeof b.secret!=='string'||!same(b.secret,env.STAFF_BOOTSTRAP_SECRET))return reply({error:'Invalid setup credentials'},403);
   const existing=await env.DB.prepare('SELECT COUNT(*) AS n FROM staff_users').first<{n:number}>();if((existing?.n??0)!==0)return reply({error:'Initial setup already completed'},409);
   const salt=randomHex(16),hash=await pinHash(b.pin,salt,env.STAFF_PIN_PEPPER);
   try{await env.DB.prepare('INSERT INTO staff_users(username,salt,pin_hash) VALUES(?,?,?)').bind(b.username,salt,hash).run();return reply({ok:true,message:'First staff account created. Remove STAFF_BOOTSTRAP_SECRET from Worker secrets.'},201)}catch{return reply({error:'Setup unavailable'},409)}
  }
  if(path==='/api/staff/login'&&req.method==='POST'){
   if(!env.STAFF_PIN_PEPPER)return reply({error:'Staff login not configured'},503);
   const b=await body(req);if(!validName(b.username)||!validPin(b.pin))return reply({error:'Invalid credentials'},401);
   const username=b.username.toLowerCase(),now=Date.now();
   const attempts=await env.DB.prepare('SELECT attempts,locked_until FROM staff_login_attempts WHERE username=?').bind(username).first<{attempts:number;locked_until:number}>();
   if(attempts&&attempts.locked_until>now)return reply({error:'Too many attempts. Try later.'},429);
   const staff=await env.DB.prepare('SELECT id,username,salt,pin_hash FROM staff_users WHERE username=? AND enabled=1').bind(username).first<{id:number;username:string;salt:string;pin_hash:string}>();
   const hash=await pinHash(b.pin,staff?.salt??'invalid-user-salt',env.STAFF_PIN_PEPPER);
   if(!staff||!same(hash,staff.pin_hash)){
    const count=(attempts?.attempts??0)+1;
    await env.DB.prepare('INSERT INTO staff_login_attempts(username,attempts,locked_until) VALUES(?,?,?) ON CONFLICT(username) DO UPDATE SET attempts=excluded.attempts,locked_until=excluded.locked_until').bind(username,count,count>=5?now+15*60*1000:0).run();
    return reply({error:'Invalid credentials'},401);
   }
   await env.DB.prepare('DELETE FROM staff_login_attempts WHERE username=?').bind(username).run();
   const token=randomHex(32),expires=now+8*60*60*1000;
   await env.DB.prepare('INSERT INTO staff_sessions(token_hash,staff_id,expires_at) VALUES(?,?,?)').bind(await hashToken(token),staff.id,expires).run();
   const response=reply({authenticated:true,staff:{id:staff.id,username:staff.username}});
   response.headers.append('Set-Cookie',cookie(token,8*60*60));return response;
  }
  if(path==='/api/staff/logout'&&req.method==='POST'){
   const token=readCookie(req);if(/^[0-9a-f]{64}$/.test(token))await env.DB.prepare('DELETE FROM staff_sessions WHERE token_hash=?').bind(await hashToken(token)).run();
   const response=reply({ok:true});response.headers.append('Set-Cookie',cookie('',0));return response;
  }
  const staff=await user(req,env);if(!staff)return reply({error:'Staff authentication required'},401);
  // Explicitly fail closed: financial APIs need a separate, reviewed D1 integration.
  return reply({error:'Protected staff API is not yet enabled for production billing'},503);
 }
};
