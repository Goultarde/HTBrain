const AUTH_SERVER = 'http://localhost:5001';

export async function GET() {
  try {
    const res = await fetch(`${AUTH_SERVER}/status`);
    const data = await res.json();
    return Response.json(data);
  } catch {
    // Auth server not running — fall back to reading cookie file directly
    const { readCookies, isValidSession } = await import('@/lib/cookieStore');
    const cookies = readCookies();
    return Response.json({
      loggedIn: isValidSession(cookies),
      browserOpen: false,
      pathId: cookies?._pathId ?? null,
      status: 'idle',
    });
  }
}
