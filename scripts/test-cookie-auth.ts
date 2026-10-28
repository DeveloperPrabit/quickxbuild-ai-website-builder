import crypto from 'node:crypto';

async function main() {
  const secret = process.env.BETTER_AUTH_SECRET || '';
  const token = 'fresh_prabit_token_2026_enterprise';
  const hmac = crypto.createHmac('sha256', secret).update(token).digest('base64url');
  const signedCookie = `${token}.${hmac}`;
  console.log('Signed cookie:', signedCookie);

  const res = await fetch('http://localhost:3000/api/auth/get-session', {
    headers: {
      Cookie: `better-auth.session_token=${signedCookie}`,
    },
  });
  console.log('Signed Cookie status:', res.status, await res.text());
}

main().catch(console.error);
