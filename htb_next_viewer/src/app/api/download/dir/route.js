import path from 'path';

export async function GET() {
  return Response.json({ dir: path.join(process.cwd(), '../data/HTB_Modules') });
}
