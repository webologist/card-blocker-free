import type { NextApiRequest, NextApiResponse } from 'next';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getSupabaseServerClient } = require('../../lib/supabase-server');

// Vercel copy of server.js's /api/health, added 4 Oct 2026 after the
// production database had been unreachable for some time with nothing to
// say so: the home page still loaded, OTPs were still issued, and the only
// symptom was users being treated as new signups after logging in. Point an
// uptime monitor at this URL - it answers 200 only when a real query against
// the database succeeds, and 503 the moment it does not (project paused,
// deleted, wrong URL/key in the environment, network failure).
//
// Deliberately reveals nothing beyond up/down - no hostnames, keys or error
// text - so it is safe to leave public.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const timestamp = new Date().toISOString();

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return res.status(503).json({ status: 'error', database: 'not-configured', timestamp });
  }

  try {
    // supabase-js reports an unreachable database as { error }, not a throw.
    const { error } = await supabase.from('kv_store').select('key').limit(1);
    if (error) {
      console.error('[HEALTH] Database check failed:', error.message);
      return res.status(503).json({ status: 'error', database: 'unreachable', timestamp });
    }
    return res.status(200).json({ status: 'ok', database: 'ok', timestamp });
  } catch (e) {
    console.error('[HEALTH] Database check failed:', (e as Error).message);
    return res.status(503).json({ status: 'error', database: 'unreachable', timestamp });
  }
}
