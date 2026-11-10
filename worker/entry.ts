// Safe initial D1 binding activation.
// Staff billing endpoints remain disabled until authentication and tests are complete.
interface Env { DB: D1Database; ASSETS: Fetcher }
export default {
 async fetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/api/health') {
   if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
   try {
    const result = await env.DB.prepare('SELECT COUNT(*) AS count FROM stations').first<{count:number}>();
    return Response.json({ ok: true, database: 'connected', stationCount: result?.count ?? 0 }, { headers: { 'Cache-Control': 'no-store' } });
   } catch {
    return Response.json({ ok: false, database: 'unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
   }
  }
  if (url.pathname.startsWith('/api/')) return Response.json({ error: 'API not enabled yet' }, { status: 404 });
  return env.ASSETS.fetch(request);
 }
};
