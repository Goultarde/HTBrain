import { writeCookies } from '@/lib/cookieStore';

export async function POST() {
  writeCookies({});
  return Response.json({ loggedOut: true });
}
