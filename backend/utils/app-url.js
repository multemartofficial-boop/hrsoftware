// Resolve the public base URL of the frontend for links in emails.
// Priority: the browser's Origin header → explicit FRONTEND_URL env →
// forwarded proto + host (Vercel serves the SPA and API on the same domain,
// so the request host IS the public site) → local dev fallback.
const appBaseUrl = (req) => {
  const origin = req?.headers?.origin;
  if (origin && /^https?:\/\//.test(origin)) return origin.replace(/\/+$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`.replace(/\/+$/, '');
  if (process.env.FRONTEND_URL) return process.env.FRONTEND_URL.replace(/\/+$/, '');
  const host = req?.headers?.['x-forwarded-host'] || req?.headers?.host;
  if (host) {
    const proto = (req?.headers?.['x-forwarded-proto'] || 'https').split(',')[0].trim();
    return `${proto}://${host}`;
  }
  return 'http://localhost:8080';
};

module.exports = { appBaseUrl };
