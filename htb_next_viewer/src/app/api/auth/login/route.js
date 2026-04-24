const AUTH_SERVER = 'http://localhost:5001';

export async function POST() {
  try {
    const res = await fetch(`${AUTH_SERVER}/login`, { method: 'POST' });
    const data = await res.json();
    return Response.json(data);
  } catch {
    return Response.json({ error: 'Auth server not running. Launch auth_server.py first.' }, { status: 503 });
  }
}
