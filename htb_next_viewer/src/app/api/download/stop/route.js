import { activeProcesses } from '@/lib/activeDownloads';

export async function POST(request) {
  const { sessionId } = await request.json();
  const procs = activeProcesses.get(sessionId);
  if (procs) {
    for (const p of procs) {
      try { p.kill('SIGTERM'); } catch {}
    }
    activeProcesses.delete(sessionId);
  }
  return Response.json({ stopped: true });
}
