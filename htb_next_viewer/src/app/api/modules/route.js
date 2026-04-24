import { getLocalModules } from '@/lib/modules';

export async function GET() {
  const modules = getLocalModules();
  return Response.json({ modules });
}
