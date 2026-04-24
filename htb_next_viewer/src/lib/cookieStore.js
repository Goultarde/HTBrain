import fs from 'fs';
import path from 'path';

const COOKIE_FILE = path.join(process.cwd(), '../runtime/cookies.json');

export function readCookies() {
  try {
    const raw = fs.readFileSync(COOKIE_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function writeCookies(cookieObj) {
  fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookieObj, null, 2));
}

export function cookiesToString(cookieObj) {
  return Object.entries(cookieObj)
    .filter(([k]) => !k.startsWith('_'))
    .map(([k, v]) => `${k}=${v}`)
    .join('; ') + ';';
}

export function isValidSession(cookieObj) {
  return !!(cookieObj?.htb_academy_session && cookieObj?.XSRF_TOKEN || cookieObj?.['XSRF-TOKEN']);
}
