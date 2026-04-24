import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { readCookies, isValidSession, cookiesToString } from '@/lib/cookieStore';
import { activeProcesses } from '@/lib/activeDownloads';

const BINARY = path.join(process.cwd(), '../htb_academy_module_downloader/htb-academy-to-md');
const DEFAULT_DOWNLOAD_DIR = path.join(process.cwd(), '../data/HTB_Modules');

function sseEvent(data) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request) {
  const cookies = readCookies();
  if (!isValidSession(cookies)) {
    return Response.json({ error: 'not_authenticated' }, { status: 401 });
  }

  const { modules, saveImages = true, forceRedownload = false, downloadDir: clientDir } = await request.json();
  const DOWNLOAD_DIR = clientDir || DEFAULT_DOWNLOAD_DIR;
  if (!modules?.length) {
    return Response.json({ error: 'no_modules' }, { status: 400 });
  }

  const cookieStr = cookiesToString(cookies);
  const sessionId = Date.now().toString();
  const processList = [];
  activeProcesses.set(sessionId, processList);

  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (data) => {
        try { controller.enqueue(encoder.encode(sseEvent(data))); } catch {}
      };

      enqueue({ type: 'sessionId', sessionId });
      enqueue({ type: 'progress', current: 0, total: modules.length });

      let completed = 0;

      for (let i = 0; i < modules.length; i++) {
        const mod = modules[i];

        // Check if cancelled
        if (!activeProcesses.has(sessionId)) {
          enqueue({ type: 'log', module: mod.title, line: '[!] Download cancelled.' });
          break;
        }

        enqueue({ type: 'log', module: mod.title, line: `\n[${i + 1}/${modules.length}] Starting: ${mod.title}` });

        // Resolve redirect: /app/module/ID → /app/module/ID/section/XXXX
        let resolvedUrl = mod.url;
        try {
          const res = await fetch(mod.url, {
            headers: { Cookie: cookieStr, 'User-Agent': 'Mozilla/5.0' },
            redirect: 'follow',
          });
          if (res.url && res.url !== mod.url) resolvedUrl = res.url;
        } catch {
          enqueue({ type: 'log', module: mod.title, line: '   [!] URL resolution failed, using module URL directly.' });
        }

        enqueue({ type: 'log', module: mod.title, line: `   [+] Downloading from: ${resolvedUrl}` });

        const args = ['-m', resolvedUrl, '-c', cookieStr];
        if (saveImages) args.push('-save-images');
        if (forceRedownload) args.push('-force');

        await new Promise((resolve) => {
          const proc = spawn(BINARY, args, {
            cwd: DOWNLOAD_DIR,
            env: { ...process.env },
          });
          processList.push(proc);

          proc.stdout.on('data', (data) => {
            for (const line of data.toString().split('\n')) {
              const clean = line.trim();
              if (clean) enqueue({ type: 'log', module: mod.title, line: `   ${clean}` });
            }
          });
          proc.stderr.on('data', (data) => {
            for (const line of data.toString().split('\n')) {
              const clean = line.trim();
              if (clean) enqueue({ type: 'log', module: mod.title, line: `   [!] ${clean}` });
            }
          });

          proc.on('close', (code) => {
            if (code === 0) {
              enqueue({ type: 'log', module: mod.title, line: `   [✓] ${mod.title} done!` });
            } else {
              enqueue({ type: 'log', module: mod.title, line: `   [✗] Failed (exit code ${code})` });
            }
            const idx = processList.indexOf(proc);
            if (idx !== -1) processList.splice(idx, 1);
            resolve();
          });

          proc.on('error', (err) => {
            enqueue({ type: 'log', module: mod.title, line: `   [!] Error: ${err.message}` });
            resolve();
          });
        });

        completed++;
        enqueue({ type: 'progress', current: completed, total: modules.length });

        // Security pause between modules (except last)
        if (i < modules.length - 1 && activeProcesses.has(sessionId)) {
          enqueue({ type: 'log', module: mod.title, line: '   [*] Pause 45s...' });
          await new Promise(r => setTimeout(r, 45000));
        }
      }

      activeProcesses.delete(sessionId);
      enqueue({ type: 'done', completed });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
