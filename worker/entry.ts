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
  // Advance reservations are staff-only; slot uniqueness is enforced by D1.
  if(path==='/api/staff/reservations'&&(req.method==='GET'||req.method==='POST')){
   const staff=await user(req,env);if(!staff)return reply({error:'Staff authentication required'},401);
   if(req.method==='GET'){
    const from=Number(url.searchParams.get('from'))||Date.now()-86400000;
    const to=Number(url.searchParams.get('to'))||Date.now()+30*86400000;
    if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from||to-from>45*86400000)return reply({error:'Invalid date range'},400);
    try{const rows=await env.DB.prepare("SELECT r.id,r.station_id,s.name AS station_name,r.customer_name,r.customer_phone,r.party_size,r.starts_at,r.ends_at,r.status,r.notes FROM reservations r JOIN stations s ON s.id=r.station_id WHERE r.starts_at<? AND r.ends_at>? ORDER BY r.starts_at ASC LIMIT 500").bind(to,from).all();return reply({reservations:rows.results})}catch{return reply({error:'Reservation database migration required'},503)}
   }
   const b=await body(req),stationId=Number(b.station_id),partySize=Number(b.party_size),start=Number(b.starts_at),end=Number(b.ends_at);
   const name=typeof b.customer_name==='string'?b.customer_name.trim():'';
   const phone=typeof b.customer_phone==='string'?b.customer_phone.trim():'';
   const notes=typeof b.notes==='string'?b.notes.trim():'';
   const now=Date.now(),slot=300000;
   if(!Number.isInteger(stationId)||!Number.isInteger(partySize)||partySize<1||partySize>20||name.length<2||name.length>100||phone.length>30||notes.length>500||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<now-60000||start>now+30*86400000||end<=start||end-start>4*3600000||end-start<15*60000||start%slot!==0||end%slot!==0)return reply({error:'Invalid booking. Choose a future 5-minute time slot and a duration between 15 minutes and 4 hours.'},400);
   const station=await env.DB.prepare('SELECT id FROM stations WHERE id=? AND enabled=1').bind(stationId).first();
   if(!station)return reply({error:'Station unavailable'},404);
   const open=await env.DB.prepare("SELECT id FROM sessions WHERE station_id=? AND status IN ('active','paused') LIMIT 1").bind(stationId).first();
   if(open)return reply({error:'Table has an active session; cannot confirm an advance booking until it ends.'},409);
   // Assign a unique reservation ID before batching. Do not rely on last_insert_rowid()
   // across D1 prepared statements. UNIQUE slot keys reject concurrent overlapping writes.
   const slots:number[]=[];for(let t=start;t<end;t+=slot)slots.push(t);
   const idBytes=new Uint8Array(6);crypto.getRandomValues(idBytes);
   const reservationId=idBytes.reduce((n,b)=>n*256+b,0);
   try{
    const statements=[env.DB.prepare("INSERT INTO reservations(id,station_id,customer_name,customer_phone,party_size,starts_at,ends_at,status,notes,created_by,created_at) VALUES(?,?,?,?,?,?,?,'confirmed',?,?,?)").bind(reservationId,stationId,name,phone,partySize,start,end,notes,staff.id,now),
      ...slots.map(t=>env.DB.prepare('INSERT INTO reservation_slots(station_id,slot_start,reservation_id) VALUES(?,?,?)').bind(stationId,t,reservationId))];
    await env.DB.batch(statements);
    return reply({ok:true,id:reservationId},201);
   }catch(e){
    const message=e instanceof Error?e.message:String(e);
    if(/UNIQUE constraint failed: reservation_slots|PRIMARY KEY constraint failed: reservation_slots/i.test(message))return reply({error:'This table is already reserved during the selected time. Choose another slot.'},409);
    if(/no such table|no such column/i.test(message))return reply({error:'Reservation migration 0003 has not been applied to the active D1 database.'},503);
    console.error('Reservation creation failed',message);
    return reply({error:'Reservation could not be saved. Check Worker logs for the database error.'},500);
   }
  }
  if(path.startsWith('/api/staff/reservations/')&&/^\\d+$/.test(path.slice('/api/staff/reservations/'.length))&&req.method==='POST'){
   const staff=await user(req,env);if(!staff)return reply({error:'Staff authentication required'},401);
   const id=Number(path.split('/').pop()),b=await body(req);
   if(b.action!=='cancel'&&b.action!=='complete')return reply({error:'Invalid action'},400);
   try{
    const existing=await env.DB.prepare("SELECT id,status FROM reservations WHERE id=?").bind(id).first<{id:number;status:string}>();
    if(!existing)return reply({error:'Reservation not found'},404);
    if(existing.status!=='confirmed')return reply({error:'Reservation is already closed'},409);
    await env.DB.batch([
      env.DB.prepare("UPDATE reservations SET status=? WHERE id=? AND status='confirmed'").bind(b.action==='cancel'?'cancelled':'completed',id),
      env.DB.prepare('DELETE FROM reservation_slots WHERE reservation_id=?').bind(id)
    ]);
    return reply({ok:true});
   }catch{return reply({error:'Reservation database migration required'},503)}
  }

  // CMS 3.0 financial ledger: all endpoints require a valid staff session.
  if(path==='/api/staff/cms/summary'&&req.method==='GET'){
   const staff=await user(req,env);if(!staff)return reply({error:'Staff authentication required'},401);
   const from=Number(url.searchParams.get('from')),to=Number(url.searchParams.get('to'));
   if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from>=to||to-from>370*86400000)return reply({error:'Invalid reporting range'},400);
   try{
    const [totals,categories,methods]=await Promise.all([
     env.DB.prepare("SELECT entry_type,COUNT(*) count,COALESCE(SUM(amount_paise),0) amount_paise FROM cms_transactions WHERE voided_at IS NULL AND occurred_at>=? AND occurred_at<? GROUP BY entry_type").bind(from,to).all(),
     env.DB.prepare("SELECT entry_type,category,COALESCE(SUM(amount_paise),0) amount_paise FROM cms_transactions WHERE voided_at IS NULL AND occurred_at>=? AND occurred_at<? GROUP BY entry_type,category ORDER BY amount_paise DESC").bind(from,to).all(),
     env.DB.prepare("SELECT entry_type,payment_method,COALESCE(SUM(amount_paise),0) amount_paise FROM cms_transactions WHERE voided_at IS NULL AND occurred_at>=? AND occurred_at<? GROUP BY entry_type,payment_method").bind(from,to).all()
    ]);
    return reply({totals:totals.results,categories:categories.results,methods:methods.results});
   }catch(e){console.error('CMS summary',e);return reply({error:'CMS migration 0004 is required'},503)}
  }
  if(path==='/api/staff/cms/transactions'&&(req.method==='GET'||req.method==='POST')){
   const staff=await user(req,env);if(!staff)return reply({error:'Staff authentication required'},401);
   if(req.method==='GET'){
    const from=Number(url.searchParams.get('from')),to=Number(url.searchParams.get('to'));
    if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from>=to||to-from>370*86400000)return reply({error:'Invalid range'},400);
    try{const rows=await env.DB.prepare("SELECT t.id,t.entry_type,t.category,t.description,t.amount_paise,t.payment_method,t.occurred_at,t.source,t.external_key,t.voided_at,c.name customer_name,s.name station_name FROM cms_transactions t LEFT JOIN cms_customers c ON c.id=t.customer_id LEFT JOIN stations s ON s.id=t.station_id WHERE t.occurred_at>=? AND t.occurred_at<? ORDER BY t.occurred_at DESC,t.id DESC LIMIT 1000").bind(from,to).all();return reply({transactions:rows.results})}catch{return reply({error:'CMS migration 0004 is required'},503)}
   }
   const b=await body(req);
   const type=b.entry_type,category=typeof b.category==='string'?b.category.trim():'',description=typeof b.description==='string'?b.description.trim():'';
   const amount=Number(b.amount_paise),at=Number(b.occurred_at),method=b.payment_method;
   const station=b.station_id==null?null:Number(b.station_id),customer=b.customer_id==null?null:Number(b.customer_id);
   const key=typeof b.external_key==='string'?b.external_key.trim():null;
   if((type!=='revenue'&&type!=='expense')||category.length<2||category.length>70||description.length>500||!Number.isSafeInteger(amount)||amount<1||amount>1000000000||!['cash','upi','card','bank','other'].includes(String(method))||!Number.isSafeInteger(at)||at<Date.UTC(2000,0,1)||at>Date.now()+86400000||(station!==null&&!Number.isSafeInteger(station))||(customer!==null&&!Number.isSafeInteger(customer))||(key!==null&&(key.length<4||key.length>150)))return reply({error:'Invalid transaction fields'},400);
   try{
    const r=await env.DB.prepare("INSERT INTO cms_transactions(external_key,entry_type,category,description,amount_paise,payment_method,occurred_at,customer_id,station_id,source,staff_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,'manual',?,?)").bind(key,type,category,description,amount,method,at,customer,station,staff.id,Date.now()).run();
    return reply({ok:true,id:r.meta.last_row_id},201);
   }catch(e){const msg=String(e);if(/UNIQUE constraint failed/.test(msg))return reply({error:'Duplicate external reference'},409);console.error('CMS transaction',e);return reply({error:'Unable to save transaction. Check migration 0004 and linked IDs.'},503)}
  }
  if(path==='/api/staff/cms/customers'&&(req.method==='GET'||req.method==='POST')){
   const staff=await user(req,env);if(!staff)return reply({error:'Staff authentication required'},401);
   try{
    if(req.method==='GET'){const r=await env.DB.prepare('SELECT id,name,phone,created_at FROM cms_customers ORDER BY name LIMIT 1000').all();return reply({customers:r.results})}
    const b=await body(req),name=typeof b.name==='string'?b.name.trim():'',phone=typeof b.phone==='string'?b.phone.trim():'';
    if(name.length<2||name.length>100||phone.length<5||phone.length>25)return reply({error:'Enter a name and a valid phone number'},400);
    const r=await env.DB.prepare('INSERT INTO cms_customers(name,phone,created_at) VALUES(?,?,?)').bind(name,phone,Date.now()).run();return reply({ok:true,id:r.meta.last_row_id},201);
   }catch(e){if(/UNIQUE constraint failed/.test(String(e)))return reply({error:'This phone number already exists'},409);return reply({error:'CMS migration 0004 is required'},503)}
  }
  if(/^\/api\/staff\/cms\/transactions\/\d+\/void$/.test(path)&&req.method==='POST'){
   const staff=await user(req,env);if(!staff)return reply({error:'Staff authentication required'},401);
   const id=Number(path.split('/')[5]),b=await body(req),reason=typeof b.reason==='string'?b.reason.trim():'';
   if(reason.length<5||reason.length>300)return reply({error:'Provide a reason (5-300 characters)'},400);
   try{const r=await env.DB.prepare('UPDATE cms_transactions SET voided_at=?,voided_by=?,void_reason=? WHERE id=? AND voided_at IS NULL').bind(Date.now(),staff.id,reason,id).run();return r.meta.changes?reply({ok:true}):reply({error:'Record not found or already voided'},409)}catch{return reply({error:'CMS migration 0004 is required'},503)}
  }
  if(path==='/api/staff/cms/import'&&req.method==='POST'){
   const staff=await user(req,env);if(!staff)return reply({error:'Staff authentication required'},401);
   const b=await body(req),rows=b.rows,label=typeof b.label==='string'?b.label.trim():'';
   if(!Array.isArray(rows)||rows.length<1||rows.length>100||label.length<3||label.length>100)return reply({error:'Import 1-100 rows at a time with a batch label'},400);
   const parsed:{key:string;type:string;category:string;description:string;amount:number;method:string;at:number}[]=[];
   for(const raw of rows){if(!raw||typeof raw!=='object')return reply({error:'Invalid import row'},400);const r=raw as Record<string,unknown>;const key=String(r.external_key||''),type=String(r.entry_type||''),category=String(r.category||''),description=String(r.description||''),amount=Number(r.amount_paise),method=String(r.payment_method||''),at=Number(r.occurred_at);
    if(key.length<4||key.length>150||!['revenue','expense'].includes(type)||category.length<2||category.length>70||description.length>500||!Number.isSafeInteger(amount)||amount<1||amount>1000000000||!['cash','upi','card','bank','other'].includes(method)||!Number.isSafeInteger(at)||at<Date.UTC(2000,0,1)||at>Date.now()+86400000)return reply({error:'Invalid import row: '+key},400);
    parsed.push({key,type,category,description,amount,method,at});
   }
   if(new Set(parsed.map(x=>x.key)).size!==parsed.length)return reply({error:'Duplicate references within the import batch'},409);
   try{
    const now=Date.now();
    const statements=parsed.map(x=>env.DB.prepare("INSERT INTO cms_transactions(external_key,entry_type,category,description,amount_paise,payment_method,occurred_at,source,staff_id,created_at) VALUES(?,?,?,?,?,?,?,'import',?,?)").bind(x.key,x.type,x.category,x.description,x.amount,x.method,x.at,staff.id,now));
    statements.push(env.DB.prepare('INSERT INTO cms_import_batches(label,imported_by,created_at,accepted,rejected) VALUES(?,?,?,?,0)').bind(label,staff.id,now,parsed.length));
    await env.DB.batch(statements);return reply({ok:true,imported:parsed.length},201);
   }catch(e){console.error('CMS import',e);return reply({error:'Import failed. Check migration 0004 and duplicate external references; no rows should be accepted from this batch.'},409)}
  }

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
