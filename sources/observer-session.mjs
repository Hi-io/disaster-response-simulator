// Cookies share a host across ports. Keep each local laboratory independent.
export const observerCookieName = (port) => `aidscaler_observer_${port}`;
export function observerCredential(req, port) {
  const bearer = req.headers.authorization?.replace(/^Bearer /, '');
  if (bearer !== undefined) return bearer;
  const cookies = new Map(String(req.headers.cookie ?? '').split(';').map(part => {
    const split = part.indexOf('=');
    return [part.slice(0, split).trim(), part.slice(split + 1)];
  }));
  // A scoped credential always wins, even if invalid. Existing own legacy
  // sessions still authenticate; a new login never overwrites another port.
  return cookies.get(observerCookieName(port)) ?? cookies.get('observer') ?? '';
}
export const observerSessionCookie = (key, port) => `${observerCookieName(port)}=${key}; HttpOnly; SameSite=Strict; Path=/`;
