export async function GET() {
  const res = await fetch('http://localhost:5001/dashboard-modules');
  const data = await res.json();
  return Response.json(data);
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const res = await fetch('http://localhost:5001/refresh-dashboard-modules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return Response.json(data);
}

