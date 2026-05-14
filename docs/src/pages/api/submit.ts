import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json() as Record<string, any>;
    const salt = env.IP_HASH_SALT ?? 'dev-salt-replace-in-production';
    const ipHash = await hashIP(request.headers.get('cf-connecting-ip') || '', salt);

    await env.DB.prepare(`
      INSERT INTO responses
      (role, use_cases, team_size, frequency, pain_ranking, satisfaction, improvement_wish, user_agent, ip_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      body.role || null,
      JSON.stringify(body.use_case || []),
      body.team_size || null,
      body.frequency ?? null,
      JSON.stringify(body.pain_points || []),
      body.satisfaction ?? null,
      body.nps_why || null,
      request.headers.get('user-agent') || '',
      ipHash
    ).run();

    return Response.json({ ok: true });
  } catch (err: any) {
    return Response.json({ ok: false, error: err.message }, { status: 500 });
  }
};

async function hashIP(ip: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(ip + salt);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}
