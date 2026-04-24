const log = (...args) => console.log('[path/modules]', ...args);

export async function GET() {
  log('proxy → auth_server /path-modules');
  try {
    const res = await fetch('http://localhost:5001/path-modules');
    const data = await res.json();
    log('auth_server réponse:', JSON.stringify(data).slice(0, 200));

    if (data.error) {
      const statusMap = { session_expired: 401, not_authenticated: 401, no_path_id: 400 };
      const status = statusMap[data.error] ?? 500;
      return Response.json({ error: data.error }, { status });
    }

    return Response.json({ modules: data.modules, pathId: data.pathId });
  } catch (err) {
    log('→ exception:', err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
