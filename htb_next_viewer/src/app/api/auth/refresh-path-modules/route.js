export async function POST() {
  const res = await fetch('http://localhost:5001/refresh-path-modules', { method: 'POST' });
  const data = await res.json();
  return Response.json(data);
}
