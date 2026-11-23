// Prime Maths Tutoring: sends notification emails.
// The database schedule calls this every couple of minutes when something is waiting (see email-schedule.sql).
// Each person gets one email listing everything new for them, and parents get a copy of homework, reminders
// and marks if their child's tutor has turned that on. Emails go out through Resend (resend.com).
//
// Secrets this function uses (Supabase dashboard: Edge Functions, then Secrets):
//   RESEND_API_KEY   from resend.com. Without it, nothing is emailed (notifications still show in the student area).
//   EMAIL_FROM       optional, e.g. "Prime Maths Tutoring <notifications@primemathstutoring.co.uk>"
import postgres from 'npm:postgres@3.4.5';

const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 1 });
const SITE = 'https://www.primemathstutoring.co.uk';
const FROM = Deno.env.get('EMAIL_FROM') || 'Prime Maths Tutoring <notifications@primemathstutoring.co.uk>';
const REPLY_TO = 'hello@primemathstutoring.co.uk';

type Row = {
  id: string; user_id: string; email: string; full_name: string; role: string; kind: string; title: string; body: string;
  homework_id: string | null; student_id: string | null; created_at: Date;
  parent_email: string; parent_name: string; parent_copy: boolean;
};
type Email = { to: string; subject: string; html: string; text: string; ids: string[] };

const esc = (s: string) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
// Postgres array literal for a list of ids (they're UUIDs from the database, so no quoting is needed)
const idList = (ids: string[]) => '{' + ids.join(',') + '}';
const first = (name: string) => (name || '').trim().split(/\s+/)[0] || '';

function sameSecret(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Where each notification's button takes you in the student area
function link(r: Row) {
  if (r.kind === 'message') return `${SITE}/portal?go=messages${r.role === 'student' ? '' : '&s=' + r.student_id}`;
  if (r.kind === 'handed_in') return `${SITE}/portal?go=marking`;
  if (r.homework_id) return `${SITE}/portal?go=homework&hw=${r.homework_id}`;
  return `${SITE}/portal`;
}

function layout(heading: string, intro: string, items: { title: string; body: string; url: string }[], footer: string) {
  const blocks = items.map((it) => `
        <tr><td style="padding:0 0 14px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E4E4E7;border-radius:10px;">
            <tr><td style="padding:16px 18px;">
              <p style="margin:0 0 4px 0;font-size:16px;font-weight:600;color:#18181B;">${esc(it.title)}</p>
              ${it.body ? `<p style="margin:0 0 12px 0;font-size:14px;line-height:1.5;color:#55565C;">${esc(it.body)}</p>` : ''}
              <a href="${it.url}" style="display:inline-block;background:#E8AE4A;color:#0A0A0B;text-decoration:none;font-weight:600;font-size:14px;padding:9px 16px;border-radius:999px;">Open in the student area</a>
            </td></tr>
          </table>
        </td></tr>`).join('');
  return `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(heading)}</title></head>
<body style="margin:0;padding:0;background:#F4F4F5;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F4F5;">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
        <tr><td style="background:#0A0A0B;border-radius:12px 12px 0 0;padding:16px 20px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="padding-right:12px;"><img src="${SITE}/images/logo-on-dark.png" width="40" height="40" alt="" style="display:block;border:0;"></td>
            <td style="color:#F4F4F2;font-size:17px;font-weight:600;">Prime Maths Tutoring</td>
          </tr></table>
        </td></tr>
        <tr><td style="background:#FFFFFF;border-radius:0 0 12px 12px;padding:24px 20px 10px 20px;">
          <p style="margin:0 0 6px 0;font-size:20px;font-weight:600;color:#18181B;">${esc(heading)}</p>
          <p style="margin:0 0 18px 0;font-size:14px;line-height:1.5;color:#55565C;">${esc(intro)}</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${blocks}</table>
        </td></tr>
        <tr><td style="padding:16px 8px;font-size:12px;line-height:1.5;color:#71717A;text-align:center;">${footer}</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function plain(heading: string, intro: string, items: { title: string; body: string; url: string }[], footer: string) {
  return [heading, '', intro, '', ...items.flatMap((it) => [it.title, it.body, it.url, '']), footer.replace(/<[^>]+>/g, '')].filter((l) => l !== undefined).join('\n');
}

function compose(rows: Row[]): Email[] {
  const emails: Email[] = [];
  const byUser = new Map<string, Row[]>();
  for (const r of rows) byUser.set(r.user_id, [...(byUser.get(r.user_id) || []), r]);
  for (const list of byUser.values()) {
    const p = list[0];
    const items = list.map((r) => ({ title: r.title, body: r.body, url: link(r) }));
    const heading = items.length === 1 ? items[0].title : `${items.length} updates in your student area`;
    const intro = `Hi ${first(p.full_name) || 'there'}, here's what's new.`;
    const footer = `You're getting this because you have an account in the Prime Maths Tutoring student area. ` +
      `<a href="${SITE}/portal?go=settings" style="color:#71717A;">Choose which emails you get</a>.`;
    emails.push({ to: p.email, subject: heading, html: layout(heading, intro, items, footer), text: plain(heading, intro, items, footer), ids: list.map((r) => r.id) });

    const forParent = list.filter((r) => r.parent_copy);
    if (forParent.length && p.parent_email) {
      const child = first(p.full_name) || 'your child';
      const pItems = forParent.map((r) => ({ title: r.title, body: r.body, url: `${SITE}/portal` }));
      const pHeading = `An update on ${child}'s maths`;
      const pIntro = `Hi${p.parent_name ? ' ' + first(p.parent_name) : ''}, here's the latest on ${child}'s homework with Prime Maths Tutoring.`;
      const pFooter = `You're getting this because ${esc(child)}'s tutor added you for updates. To stop them, reply to this email and let us know.`;
      emails.push({ to: p.parent_email, subject: pHeading, html: layout(pHeading, pIntro, pItems, pFooter), text: plain(pHeading, pIntro, pItems, pFooter), ids: [] });
    }
  }
  return emails;
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  const given = req.headers.get('x-pmt-secret') || '';
  const [secret] = await sql`select decrypted_secret as value from vault.decrypted_secrets where name = 'pmt_email_secret'`;
  if (!secret || !given || !sameSecret(given, secret.value)) return json({ error: 'Not allowed' }, 401);

  const options = await req.json().catch(() => ({}));
  const dry = options && options.dry === true;
  const rows = (await sql`select * from public.claim_emails(${dry ? '0 seconds' : '1 minute'}::interval)`) as unknown as Row[];
  if (!rows.length) return json({ emails: 0 });
  const ids = rows.map((r) => r.id);
  const emails = compose(rows);

  // A test run: show what would be sent, and leave everything waiting.
  if (dry) {
    await sql`update public.notifications set email_status = null where id = any(${idList(ids)}::uuid[])`;
    return json({ dry: true, emails: emails.map((e) => ({ to: e.to, subject: e.subject, text: e.text })) });
  }

  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) {
    await sql`select public.finish_emails(${idList(ids)}::uuid[], 'not_configured')`;
    return json({ emails: 0, note: 'RESEND_API_KEY is not set, so nothing was emailed' });
  }

  // One at a time, so one bad address (say, a mistyped parent email) can't hold up everyone else's.
  // Resend allows a couple of requests a second, so leave a short gap between them.
  let sent = 0;
  const failed: string[] = [];
  for (const [i, e] of emails.entries()) {
    if (i) await new Promise((r) => setTimeout(r, 600));
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [e.to], reply_to: REPLY_TO, subject: e.subject, html: e.html, text: e.text }),
    });
    if (res.ok) sent += 1;
    else {
      failed.push(...e.ids);
      console.error('Resend error', res.status, await res.text());
    }
  }
  const ok = ids.filter((id) => !failed.includes(id));
  if (ok.length) await sql`select public.finish_emails(${idList(ok)}::uuid[], 'sent')`;
  if (failed.length) await sql`select public.finish_emails(${idList(failed)}::uuid[], 'failed')`;
  return json({ emails: sent, failed: failed.length });
});
