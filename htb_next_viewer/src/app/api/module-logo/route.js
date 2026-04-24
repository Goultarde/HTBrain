import fs from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { readCookies, cookiesToString } from '@/lib/cookieStore';

const MODULES_DIR = path.join(process.cwd(), '../data/HTB_Modules/modules');
const HTB_BASE = 'https://academy.hackthebox.com';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const moduleId = searchParams.get('id');
    if (!moduleId || !/^\d+$/.test(moduleId)) {
        return NextResponse.json({ error: 'invalid id' }, { status: 400 });
    }

    const cacheFile = path.join(MODULES_DIR, 'images', `logo-${moduleId}.png`);

    // Serve from cache if exists
    if (fs.existsSync(cacheFile)) {
        const buf = fs.readFileSync(cacheFile);
        return new NextResponse(buf, {
            headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000' },
        });
    }

    // Fetch logo from HTB Academy
    const cookies = readCookies();
    const cookieStr = cookiesToString(cookies);

    try {
        // HTB Academy module API returns module details including thumbnail
        const apiRes = await fetch(`${HTB_BASE}/api/v1/modules/${moduleId}`, {
            headers: { Cookie: cookieStr, 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
        });

        let logoUrl = null;

        if (apiRes.ok) {
            const data = await apiRes.json();
            // Try known fields for the logo/thumbnail
            const thumb = data?.data?.thumbnail || data?.thumbnail || data?.data?.logo || data?.logo;
            if (thumb) {
                logoUrl = thumb.startsWith('http') ? thumb : `${HTB_BASE}${thumb}`;
            }
        }

        // Fallback: scrape og:image from module details page
        if (!logoUrl) {
            const pageRes = await fetch(`${HTB_BASE}/module/details/${moduleId}`, {
                headers: { Cookie: cookieStr, 'User-Agent': 'Mozilla/5.0' },
                redirect: 'follow',
            });
            if (pageRes.ok) {
                const html = await pageRes.text();
                const ogMatch = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)
                    || html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/i);
                if (ogMatch) logoUrl = ogMatch[1];
            }
        }

        if (!logoUrl) {
            return NextResponse.json({ error: 'logo not found' }, { status: 404 });
        }

        // Download and cache
        const imgRes = await fetch(logoUrl, {
            headers: { Cookie: cookieStr, 'User-Agent': 'Mozilla/5.0' },
        });
        if (!imgRes.ok) return NextResponse.json({ error: 'download failed' }, { status: 502 });

        const buf = Buffer.from(await imgRes.arrayBuffer());
        fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
        fs.writeFileSync(cacheFile, buf);

        const contentType = imgRes.headers.get('content-type') || 'image/png';
        return new NextResponse(buf, {
            headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=31536000' },
        });

    } catch (err) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
