// stb-summary — read-only view of the scheduling boards and Change Orders for outside bots.
//
//   GET /functions/v1/stb-summary?token=<BOT_READ_TOKEN>                → JSON (all areas + cobros)
//   GET /functions/v1/stb-summary?token=…&format=text                   → plain-text digest
//   GET /functions/v1/stb-summary?token=…&area=main|alice|all&cobros=0  → narrow the result
//
// It only ever SELECTs. The caller never gets a database key, only this token, so a bot
// holding the token cannot change anything on the board or in Cobros.
import { summarizeBoard, summarizeCobros, activityFeed, summarizeCompleted, summarizeLessons, digest } from './summary.js';

const ROWS = { main: 'stb_board_v1', alice: 'stb_board_alice_v1', cobros: 'stb_change_orders_v1', completed: 'stb_completed_v1', lessons: 'stb_lessons_v1' };

async function readRow(id: string) {
  const url = `${Deno.env.get('SUPABASE_URL')}/rest/v1/stb_app_state?id=eq.${encodeURIComponent(id)}&select=data,updated_at`;
  const key = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const res = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`read ${id} failed (${res.status})`);
  const rows = await res.json();
  if (!rows?.[0]) return null;
  try { return { value: JSON.parse(rows[0].data?.value ?? 'null'), updatedAt: rows[0].updated_at }; } catch { return null; }
}

Deno.serve(async (req) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-bot-token, content-type', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'GET') return new Response('Read-only endpoint. Use GET.', { status: 405, headers: cors });

  const u = new URL(req.url);
  const expected = Deno.env.get('BOT_READ_TOKEN') ?? '';
  const given = u.searchParams.get('token') ?? req.headers.get('x-bot-token') ?? '';
  if (!expected || given !== expected) return new Response('Unauthorized', { status: 401, headers: cors });

  const area = (u.searchParams.get('area') ?? 'all').toLowerCase();
  const wantCobros = (u.searchParams.get('cobros') ?? '1') !== '0';
  const activityDays = Math.min(365, Math.max(0, parseInt(u.searchParams.get('days') ?? '14') || 0));
  const areas = area === 'all' ? ['main', 'alice'] : [area].filter((a) => a === 'main' || a === 'alice');
  if (!areas.length) return new Response('area must be main, alice or all', { status: 400, headers: cors });

  try {
    const today = new Date().toISOString().slice(0, 10);
    const boards = [];
    let activity: unknown[] = [];
    for (const a of areas) {
      const row = await readRow(ROWS[a as 'main' | 'alice']);
      const value = row?.value ?? { projects: [] };
      boards.push({ ...summarizeBoard(value, a, today), updatedAt: row?.updatedAt ?? null });
      if (activityDays > 0) activity = activity.concat(activityFeed(value, a, activityDays, today));
    }
    activity.sort((x: any, y: any) => String(x.at || x.day).localeCompare(String(y.at || y.day)));
    const completedRow = await readRow(ROWS.completed);
    const lessonsRow = await readRow(ROWS.lessons);
    let changeOrders = undefined;
    if (wantCobros) {
      const row = await readRow(ROWS.cobros);
      changeOrders = { ...summarizeCobros(row?.value ?? { proyectos: [] }, today), updatedAt: row?.updatedAt ?? null };
    }
    const summary = {
      generatedAt: new Date().toISOString(), boards,
      activityDays, activity,
      completedHouses: summarizeCompleted(completedRow?.value ?? [], today),
      lessonsLearned: summarizeLessons(lessonsRow?.value ?? []),
      changeOrders
    };
    if ((u.searchParams.get('format') ?? 'json') === 'text') {
      return new Response(digest(summary), { headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
    return new Response(JSON.stringify(summary, null, 2), { headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
  } catch (e) {
    return new Response(`Error: ${(e as Error).message}`, { status: 500, headers: cors });
  }
});
