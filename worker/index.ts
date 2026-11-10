import { chargePaise, ratePaise } from './billing';
interface Env { DB: D1Database; STAFF_API_KEY: string; ASSETS: Fetcher }
type Session = {id:number;station_id:number;status:string;started_at:number;ended_at:number|null;paused_at:number|null;player_count:number;base_rate_paise:number;extra_player_paise:number};
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const error=(message:string,status=400)=>json({error:message},status);
const integer=(x:unknown,min=1,max=1000000)=>Number.isSafeInteger(x)&&Number(x)>=min&&Number(x)<=max?Number(x):null;
const body=async(req:Request)=>{try{return await req.json() as Record<string,unknown>}catch{return null}};
const activeSql=`SELECT s.*,t.base_rate_paise,t.extra_player_paise FROM sessions s JOIN stations t ON t.id=s.station_id WHERE s.station_id=? AND s.status IN ('active','paused')`;
const sessionSql=`SELECT s.*,t.base_rate_paise,t.extra_player_paise FROM sessions s JOIN stations t ON t.id=s.station_id WHERE s.id=?`;
async function audit(db:D1Database,event:string,id:number){await db.prepare('INSERT INTO audit_log(event,entity_id) VALUES(?,?)').bind(event,id).run()}
async function compute(db:D1Database,s:Session,now:number){
 const rows=await db.prepare('SELECT started_at,ended_at,rate_paise_per_min FROM session_segments WHERE session_id=? ORDER BY id').bind(s.id).all<{started_at:number;ended_at:number|null;rate_paise_per_min:number}>();
 const pauseRows=await db.prepare('SELECT started_at,ended_at FROM session_pauses WHERE session_id=?').bind(s.id).all<{started_at:number;ended_at:number|null}>();
 const end=s.status==='completed'?(s.ended_at??now):now;
 const segments=(rows.results??[]).map(r=>({startedAt:r.started_at,endedAt:r.ended_at??end,ratePaisePerMinute:r.rate_paise_per_min}));
 const pauses=(pauseRows.results??[]).map(r=>({startedAt:r.started_at,endedAt:r.ended_at??end}));
 const playing=chargePaise(segments,pauses);
 const snacks=await db.prepare('SELECT COALESCE(SUM(unit_price_paise*quantity),0) AS amount FROM snack_order_items WHERE session_id=?').bind(s.id).first<{amount:number}>();
 return {playingPaise:playing,snackPaise:snacks?.amount??0,totalPaise:playing+(snacks?.amount??0)};
}
export default {
 async fetch(request:Request,env:Env):Promise<Response>{
  const url=new URL(request.url);
  if(!url.pathname.startsWith('/api/'))return env.ASSETS.fetch(request);
  if(url.pathname==='/api/health')return json({ok:true,service:'cue-tip',database:!!env.DB});
  if(!env.DB)return error('Database is not configured',503);
  if(request.method==='GET'&&url.pathname==='/api/leaderboard'){
   const rows=await env.DB.prepare(`SELECT p.id,p.name,COUNT(m.id) AS games,COALESCE(SUM(CASE WHEN m.winner_player_id=p.id THEN 1 ELSE 0 END),0) AS wins FROM players p LEFT JOIN matches m ON m.winner_player_id=p.id OR m.loser_player_id=p.id GROUP BY p.id ORDER BY wins DESC, CASE WHEN COUNT(m.id)=0 THEN 0 ELSE 1.0*SUM(CASE WHEN m.winner_player_id=p.id THEN 1 ELSE 0 END)/COUNT(m.id) END DESC,p.name LIMIT 100`).all();
   return json(rows.results);
  }
  // The key is a temporary server-side integration gate, not staff/customer login.
  // Do not enable production use until authenticated roles and audit attribution exist.
  if(!env.STAFF_API_KEY||request.headers.get('X-Cue-Tip-Staff-Key')!==env.STAFF_API_KEY)return error('Staff access required',401);
  const method=request.method,path=url.pathname;
  if(method==='GET'&&path==='/api/stations'){
   const stations=await env.DB.prepare('SELECT * FROM stations ORDER BY id').all();
   const sessions=await env.DB.prepare("SELECT * FROM sessions WHERE status IN ('active','paused')").all();
   return json({stations:stations.results,sessions:sessions.results});
  }
  if(method==='GET'&&path==='/api/players')return json((await env.DB.prepare('SELECT * FROM players ORDER BY name').all()).results);
  if(method==='GET'&&path==='/api/menu')return json((await env.DB.prepare('SELECT * FROM menu_items WHERE active=1 ORDER BY id').all()).results);
  if(method==='GET'&&path==='/api/bills')return json((await env.DB.prepare("SELECT * FROM sessions WHERE status='completed' ORDER BY ended_at DESC LIMIT 100").all()).results);
  if(method!=='POST')return error('Not found',404);
  const b=await body(request);if(!b)return error('Invalid JSON');
  if(path==='/api/players'){
   const name=typeof b.name==='string'?b.name.trim():'';if(!name||name.length>60)return error('Name must be 1–60 characters');
   try{const r=await env.DB.prepare('INSERT INTO players(name) VALUES(?)').bind(name).run();return json({id:r.meta.last_row_id,name},201)}catch{return error('Player already exists or invalid name',409)}
  }
  if(path==='/api/matches'){
   const winner=integer(b.winnerId),loser=integer(b.loserId);if(!winner||!loser||winner===loser)return error('Choose two different registered players');
   const people=await env.DB.prepare('SELECT COUNT(*) AS count FROM players WHERE id IN (?,?)').bind(winner,loser).first<{count:number}>();
   if(people?.count!==2)return error('Unknown player');
   const r=await env.DB.prepare('INSERT INTO matches(winner_player_id,loser_player_id) VALUES(?,?)').bind(winner,loser).run();
   await audit(env.DB,'match.recorded',Number(r.meta.last_row_id));return json({id:r.meta.last_row_id},201);
  }
  if(path==='/api/sessions/start'){
   const stationId=integer(b.stationId),players=integer(b.players,1,20);if(!stationId||!players)return error('Invalid station or player count');
   const station=await env.DB.prepare('SELECT * FROM stations WHERE id=? AND enabled=1').bind(stationId).first<{base_rate_paise:number;extra_player_paise:number}>();
   if(!station)return error('Station unavailable',404);
   const now=Date.now();
   try{
    // D1 batch is atomic. The unique partial index rejects concurrent starts.
    const results=await env.DB.batch([
     env.DB.prepare("INSERT INTO sessions(station_id,status,started_at,player_count) VALUES(?,'active',?,?)").bind(stationId,now,players),
     env.DB.prepare('INSERT INTO session_segments(session_id,started_at,player_count,rate_paise_per_min) VALUES(last_insert_rowid(),?,?,?)').bind(now,players,ratePaise(station.base_rate_paise,station.extra_player_paise,players))
    ]);
    return json({started:true,sessionId:results[0].meta.last_row_id},201);
   }catch{return error('Station already has an active session',409)}
  }
  const id=integer(b.sessionId);if(!id)return error('Valid sessionId required');
  const s=await env.DB.prepare(sessionSql).bind(id).first<Session>();if(!s)return error('Session not found',404);
  const now=Date.now();
  if(path==='/api/sessions/pause'){
   if(s.status!=='active')return error('Session is not active',409);
   await env.DB.batch([
    env.DB.prepare("UPDATE sessions SET status='paused',paused_at=? WHERE id=? AND status='active'").bind(now,id),
    env.DB.prepare('INSERT INTO session_pauses(session_id,started_at) VALUES(?,?)').bind(id,now)
   ]);
   await audit(env.DB,'session.paused',id);return json({ok:true});
  }
  if(path==='/api/sessions/resume'){
   if(s.status!=='paused')return error('Session is not paused',409);
   await env.DB.batch([
    env.DB.prepare("UPDATE sessions SET status='active',paused_at=NULL,accumulated_paused_ms=accumulated_paused_ms+?-paused_at WHERE id=? AND status='paused'").bind(now,id),
    env.DB.prepare('UPDATE session_pauses SET ended_at=? WHERE session_id=? AND ended_at IS NULL').bind(now,id)
   ]);
   await audit(env.DB,'session.resumed',id);return json({ok:true});
  }
  if(path==='/api/sessions/players'){
   const players=integer(b.players,1,20);if(!players||!['active','paused'].includes(s.status))return error('Invalid players or closed session');
   if(players===s.player_count)return json({ok:true});
   const newRate=ratePaise(s.base_rate_paise,s.extra_player_paise,players);
   await env.DB.batch([
    env.DB.prepare('UPDATE sessions SET player_count=? WHERE id=?').bind(players,id),
    env.DB.prepare('UPDATE session_segments SET ended_at=? WHERE session_id=? AND ended_at IS NULL').bind(now,id),
    env.DB.prepare('INSERT INTO session_segments(session_id,started_at,player_count,rate_paise_per_min) VALUES(?,?,?,?)').bind(id,now,players,newRate)
   ]);
   await audit(env.DB,'session.players.changed',id);return json({ok:true,ratePaisePerMinute:newRate});
  }
  if(path==='/api/sessions/snacks'){
   if(!['active','paused'].includes(s.status))return error('Session closed',409);
   const itemId=integer(b.itemId),qty=integer(b.quantity,1,100);if(!itemId||!qty)return error('Invalid snack item or quantity');
   const item=await env.DB.prepare('SELECT * FROM menu_items WHERE id=? AND active=1').bind(itemId).first<{name:string;price_paise:number}>();
   if(!item)return error('Menu item unavailable',404);
   const r=await env.DB.prepare('INSERT INTO snack_order_items(session_id,menu_item_id,item_name,unit_price_paise,quantity) VALUES(?,?,?,?,?)').bind(id,itemId,item.name,item.price_paise,qty).run();
   await audit(env.DB,'snack.added',id);return json({orderItemId:r.meta.last_row_id},201);
  }
  if(path==='/api/sessions/quote')return json(await compute(env.DB,s,now));
  if(path==='/api/sessions/end'){
   if(!['active','paused'].includes(s.status))return error('Session already closed',409);
   // Close all open time intervals before computing the final bill.
   await env.DB.batch([
    env.DB.prepare('UPDATE session_segments SET ended_at=? WHERE session_id=? AND ended_at IS NULL').bind(now,id),
    env.DB.prepare('UPDATE session_pauses SET ended_at=? WHERE session_id=? AND ended_at IS NULL').bind(now,id)
   ]);
   const amount=await compute(env.DB,s,now);
   const result=await env.DB.prepare("UPDATE sessions SET status='completed',ended_at=?,paused_at=NULL,play_amount_paise=?,snack_amount_paise=? WHERE id=? AND status IN ('active','paused')").bind(now,amount.playingPaise,amount.snackPaise,id).run();
   if(result.meta.changes!==1)return error('Session changed; reload',409);
   await audit(env.DB,'session.completed',id);return json({sessionId:id,...amount});
  }
  return error('Not found',404);
 }
};
