import fs from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const modulePath = searchParams.get('module');
    const image = searchParams.get('image');

    if (!modulePath || !image) {
        return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    // Racine: /htb_next_viewer
    const rootDir = process.cwd();

    // Le dossier peut être HTB_Modules ou HTB_official_box_writeups, selon l'endroit d'où vient le module
    // Le module est formaté via le nom de dossier, on va checker les deux.
    let filePath = path.join(rootDir, '../', 'data', 'HTB_Modules', modulePath, image);

    // Fallback: Check HTB_official_box_writeups too if it's not found in HTB_Modules
    if (!fs.existsSync(filePath)) {
        filePath = path.join(rootDir, '../', 'data', 'HTB_official_box_writeups', modulePath, image);
    }

    // Fallback: 0xdf writeups
    if (!fs.existsSync(filePath)) {
        filePath = path.join(rootDir, '../', 'data', 'HTB_0xdf_box_writeups', modulePath, image);
    }

    // Fallback: writeups (generic)
    if (!fs.existsSync(filePath)) {
        filePath = path.join(rootDir, '../', 'data', 'HTB_0xdf_box_writeups', modulePath, image);
    }

    // Fallback: flat file format in modules/ subfolder (e.g. HTB_Modules/modules/images/...)
    if (!fs.existsSync(filePath)) {
        filePath = path.join(rootDir, '../', 'data', 'HTB_Modules', 'modules', image);
    }

    // Fallback: flat file format — images at HTB_Modules root
    if (!fs.existsSync(filePath)) {
        filePath = path.join(rootDir, '../', 'data', 'HTB_Modules', image);
    }

    try {
        const fileBuffer = fs.readFileSync(filePath);
        return new NextResponse(fileBuffer, {
            headers: {
                'Content-Type': 'image/png', // Par défaut
                'Cache-Control': 'public, max-age=31536000',
            },
        });
    } catch (err) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
}
