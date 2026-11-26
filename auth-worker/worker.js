// GitHub OAuth helper for Decap CMS. Deploy as a Cloudflare Worker with
// secrets GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.
const ALLOWED_ORIGIN = 'https://thefringefeed.com';

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/auth') {
      const state = crypto.randomUUID();
      const gh = new URL('https://github.com/login/oauth/authorize');
      gh.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
      gh.searchParams.set('scope', 'public_repo');
      gh.searchParams.set('state', state);
      gh.searchParams.set('redirect_uri', `${url.origin}/callback`);
      return new Response(null, { status: 302, headers: { Location: gh.toString(), 'Set-Cookie': `oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600` } });
    }
    if (url.pathname === '/callback') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const cookie = (req.headers.get('Cookie') || '').match(/oauth_state=([^;]+)/)?.[1];
      if (!code || !state || state !== cookie) return page('error', { error: 'Login check failed. Close this window and try again.' });
      const r = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'fringefeed-auth' },
        body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code }),
      });
      const data = await r.json();
      if (!data.access_token) return page('error', { error: data.error_description || 'No token returned' });
      return page('success', { token: data.access_token, provider: 'github' });
    }
    return new Response('Fringe Feed editor login service', { status: 200 });
  },
};

function page(status, content) {
  const msg = `authorization:github:${status}:${JSON.stringify(content)}`;
  const html = `<!doctype html><html><body><script>
    (function () {
      function receive(e) {
        if (e.origin !== ${JSON.stringify(ALLOWED_ORIGIN)}) return;
        window.opener.postMessage(${JSON.stringify(msg)}, e.origin);
        window.removeEventListener('message', receive, false);
      }
      window.addEventListener('message', receive, false);
      window.opener.postMessage('authorizing:github', ${JSON.stringify(ALLOWED_ORIGIN)});
    })();
  </script><p>Signing you in… you can close this window if it stays open.</p></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': 'oauth_state=; Path=/; Max-Age=0' } });
}
