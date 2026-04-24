#!/usr/bin/env python3
"""
Micro-serveur HTTP pour l'authentification HTB Academy.
Utilise undetected_chromedriver pour bypasser Cloudflare.
"""
import json
import os
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import undetected_chromedriver as uc
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import NoSuchWindowException

COOKIE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../runtime/cookies.json')
MODULES_CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../runtime/path_modules_cache.json')
HTB_BASE = 'https://academy.hackthebox.com'

_state = {'driver': None, 'status': 'idle', 'path_id': None}
_lock = threading.Lock()


def _save_cookies(driver):
    cookies = driver.get_cookies()
    cookie_dict = {c['name']: c['value'] for c in cookies}

    # Conserver _pathId existant si déjà en cookies.json
    try:
        if os.path.exists(COOKIE_FILE):
            with open(COOKIE_FILE) as f:
                existing = json.load(f)
            if existing.get('_pathId'):
                cookie_dict['_pathId'] = existing['_pathId']
    except:
        pass

    # Essayer d'extraire depuis les éléments du DOM (plus fiable que page_source)
    try:
        path_links = driver.find_elements(By.CSS_SELECTOR, "a[href*='/app/paths/']")
        for link in path_links:
            href = link.get_attribute('href') or ''
            m = re.search(r'/app/paths/(\d+)', href)
            if m:
                cookie_dict['_pathId'] = m.group(1)
                break
    except:
        pass

    # Fallback : regex sur page_source
    if not cookie_dict.get('_pathId'):
        try:
            m = re.search(r'/app/paths/(\d+)', driver.page_source)
            if m:
                cookie_dict['_pathId'] = m.group(1)
        except:
            pass

    with open(COOKIE_FILE, 'w') as f:
        json.dump(cookie_dict, f)
    return cookie_dict


def _login_flow():
    with _lock:
        if _state['driver']:
            try: _state['driver'].quit()
            except: pass
            _state['driver'] = None

    try:
        options = uc.ChromeOptions()
        options.binary_location = '/usr/bin/chromium'
        options.add_argument('--window-size=1200,800')
        options.add_argument('--no-sandbox')
        options.add_argument('--disable-dev-shm-usage')
        driver = uc.Chrome(options=options, version_main=147)

        with _lock:
            _state['driver'] = driver
            _state['status'] = 'browser_open'

        # Injecter les cookies existants pour éviter de se reconnecter si la session est encore valide
        driver.get(HTB_BASE + '/')
        if os.path.exists(COOKIE_FILE):
            try:
                with open(COOKIE_FILE) as f:
                    saved = json.load(f)
                for name, value in saved.items():
                    if not name.startswith('_'):
                        try: driver.add_cookie({'name': name, 'value': value})
                        except: pass
                print('[login] cookies injectés depuis cookies.json', flush=True)
            except Exception as e:
                print(f'[login] erreur injection cookies: {e}', flush=True)
        driver.get(HTB_BASE + '/app/dashboard')

        detected_path_id = None

        while True:
            try:
                url = driver.current_url

                # Après login HTB redirige vers account.hackthebox.com/dashboard
                if 'account.hackthebox.com/dashboard' in url:
                    driver.get(HTB_BASE + '/app/dashboard')
                    time.sleep(4)
                    continue

                # Sur le dashboard academy → attendre le tab panel enrolled (selected)
                if 'academy.hackthebox.com/app/' in url and 'login' not in url:
                    try:
                        enrolled_link = WebDriverWait(driver, 8).until(
                            EC.presence_of_element_located(
                                (By.CSS_SELECTOR, "[data-headlessui-state='selected'] a[href*='/app/paths/']")
                            )
                        )
                        href = enrolled_link.get_attribute('href') or ''
                        m = re.search(r'/app/paths/(\d+)', href)
                        if m:
                            detected_path_id = m.group(1)
                            print(f'[login] enrolled path détecté: {detected_path_id} ({href})', flush=True)
                            break
                        else:
                            print(f'[login] lien trouvé sans path ID: {href}', flush=True)
                    except Exception as e:
                        print(f'[login] wait enrolled path: {str(e).splitlines()[0]}', flush=True)
                    time.sleep(2)
                    continue

            except NoSuchWindowException:
                print('[login] browser fermé par l\'utilisateur', flush=True)
                with _lock:
                    _state['status'] = 'logged_out'
                    _state['driver'] = None
                return
            except Exception as e:
                print(f'[loop] {e}', flush=True)
            time.sleep(2)

        print(f'[login] pathId depuis DOM enrolled: {detected_path_id}', flush=True)

        cookie_dict = _save_cookies(driver)
        # Priorité au pathId détecté depuis l'URL (session actuelle)
        path_id = detected_path_id or cookie_dict.get('_pathId')
        if detected_path_id:
            cookie_dict['_pathId'] = detected_path_id
            with open(COOKIE_FILE, 'w') as f:
                json.dump(cookie_dict, f)
        print(f'[login] pathId final: {path_id}', flush=True)

        # Scrape les modules AVANT de signaler logged_in au frontend
        if path_id:
            # Vider le cache pour forcer rechargement si path a changé
            try:
                if os.path.exists(MODULES_CACHE_FILE):
                    with open(MODULES_CACHE_FILE) as f:
                        old = json.load(f)
                    if old.get('pathId') != path_id:
                        os.remove(MODULES_CACHE_FILE)
                        print(f'[login] path changé ({old.get("pathId")} → {path_id}), cache vidé')
            except: pass

            result = _scrape_path_modules(driver, path_id)
            if result.get('modules'):
                try:
                    with open(MODULES_CACHE_FILE, 'w') as f:
                        json.dump(result, f)
                    print(f'[login] cache modules sauvegardé → {len(result["modules"])} modules')
                except Exception as e:
                    print(f'[login] erreur sauvegarde cache: {e}')
            else:
                print(f'[login] scrape modules échoué: {result}')

        try: driver.quit()
        except: pass

        with _lock:
            _state['status'] = 'logged_in'
            _state['path_id'] = path_id
            _state['driver'] = None

    except Exception as e:
        import traceback
        traceback.print_exc()
        with _lock:
            _state['status'] = 'error'
            _state['driver'] = None


def _scrape_path_modules(driver, path_id):
    """Extrait les modules depuis le browser déjà ouvert (non-headless, Cloudflare bypassé)."""
    target = f'{HTB_BASE}/app/paths/{path_id}/path-progress'
    print(f'[path-modules] navigation → {target}')
    driver.get(target)

    # Attendre que l'URL settle (SPA redirige parfois)
    time.sleep(3)

    current_url = driver.current_url
    print(f'[path-modules] URL: {current_url}')

    if 'login' in current_url or 'account.hackthebox.com' in current_url:
        return {'error': 'session_expired'}

    title = driver.title
    print(f'[path-modules] titre: {title}')

    if 'Rate Limited' in title or 'Take it Slow' in driver.page_source[:500]:
        return {'error': 'rate_limited'}

    # Attendre que le SPA rende les liens modules (jusqu'à 20s)
    try:
        WebDriverWait(driver, 20).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, "a[href*='/app/module/']"))
        )
        print('[path-modules] liens détectés par WebDriverWait')
    except Exception as e:
        print(f'[path-modules] WebDriverWait timeout: {e}')
        # Fallback: regex sur page_source
        ids_in_src = re.findall(r'/app/module/(\d+)', driver.page_source)
        if ids_in_src:
            seen = set()
            modules = []
            for mod_id in ids_in_src:
                if mod_id in seen: continue
                seen.add(mod_id)
                modules.append({'id': mod_id, 'title': f'Module {mod_id}', 'url': f'{HTB_BASE}/app/module/{mod_id}'})
            print(f'[path-modules] fallback regex → {len(modules)} modules')
            return {'modules': modules, 'pathId': path_id}
        return {'error': 'no_modules_found', 'page_title': title, 'url': current_url}

    links = driver.find_elements(By.CSS_SELECTOR, "a[href*='/app/module/']")
    print(f'[path-modules] {len(links)} liens trouvés')

    seen = set()
    modules = []
    for a in links:
        href = a.get_attribute('href') or ''
        m = re.search(r'/app/module/(\d+)', href)
        if not m: continue
        mod_id = m.group(1)
        if mod_id in seen: continue
        seen.add(mod_id)
        try:
            title_el = a.find_element(By.TAG_NAME, 'h2')
            mod_title = title_el.text.strip()
        except:
            mod_title = f'Module {mod_id}'
        modules.append({'id': mod_id, 'title': mod_title, 'url': f'{HTB_BASE}/app/module/{mod_id}'})

    print(f'[path-modules] → {len(modules)} modules')
    return {'modules': modules, 'pathId': path_id}


def _scrape_modules_flow():
    """Lance un browser non-headless avec cookies existants pour scraper les modules (sans re-login)."""
    with _lock:
        _state['status'] = 'browser_open'

    if not os.path.exists(COOKIE_FILE):
        with _lock: _state['status'] = 'logged_in'
        return

    try:
        with open(COOKIE_FILE) as f:
            saved = json.load(f)
    except:
        with _lock: _state['status'] = 'logged_in'
        return

    path_id = saved.get('_pathId')
    if not path_id:
        print('[scrape-flow] pas de _pathId dans cookies.json')
        with _lock: _state['status'] = 'logged_in'
        return

    try:
        options = uc.ChromeOptions()
        options.binary_location = '/usr/bin/chromium'
        options.add_argument('--window-size=1200,800')
        options.add_argument('--no-sandbox')
        options.add_argument('--disable-dev-shm-usage')
        driver = uc.Chrome(options=options, version_main=147)  # non-headless

        driver.get(HTB_BASE + '/')
        for name, value in saved.items():
            if not name.startswith('_'):
                try: driver.add_cookie({'name': name, 'value': value})
                except: pass

        result = _scrape_path_modules(driver, path_id)
        driver.quit()

        if result.get('modules'):
            with open(MODULES_CACHE_FILE, 'w') as f:
                json.dump(result, f)
            print(f'[scrape-flow] cache sauvegardé → {len(result["modules"])} modules')
        else:
            print(f'[scrape-flow] échec: {result}')
    except Exception as e:
        import traceback
        traceback.print_exc()
    finally:
        with _lock:
            _state['status'] = 'logged_in'


DASHBOARD_CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../runtime/dashboard_modules_cache.json')


def _extract_modules_from_api(data, seen, modules, _depth=0):
    """Cherche récursivement des modules dans les données API HTB.
    Un module HTB a : id numérique, name/title, et un champ 'slug' ou 'difficulty' ou 'category'."""
    if _depth > 5:
        return
    if isinstance(data, list):
        for item in data:
            if isinstance(item, dict):
                mod_id = str(item.get('id', ''))
                name = (item.get('name') or item.get('title') or '').strip()
                # Signature d'un module HTB Academy : id numérique + name + (slug ou difficulty ou category_id)
                is_module = (
                    mod_id.isdigit() and name and
                    ('slug' in item or 'difficulty' in item or 'category_id' in item or 'duration' in item)
                )
                if is_module and mod_id not in seen:
                    seen.add(mod_id)
                    modules.append({'id': mod_id, 'title': name, 'url': f'{HTB_BASE}/app/module/{mod_id}'})
                _extract_modules_from_api(item, seen, modules, _depth + 1)
    elif isinstance(data, dict):
        for v in data.values():
            if isinstance(v, (dict, list)):
                _extract_modules_from_api(v, seen, modules, _depth + 1)


def _scrape_dashboard_modules_flow():
    """Scrape les modules HTB Academy depuis le dashboard (browser non-headless, cookies injectés)."""
    if not os.path.exists(COOKIE_FILE):
        print('[dashboard-modules] pas de cookies.json', flush=True)
        with _lock: _state['status'] = 'logged_in'
        return

    try:
        with open(COOKIE_FILE) as f:
            saved = json.load(f)
    except:
        with _lock: _state['status'] = 'logged_in'
        return

    try:
        options = uc.ChromeOptions()
        options.binary_location = '/usr/bin/chromium'
        options.add_argument('--window-size=1280,900')
        options.add_argument('--no-sandbox')
        options.add_argument('--disable-dev-shm-usage')
        driver = uc.Chrome(options=options, version_main=147)

        driver.get(HTB_BASE + '/')
        for name, value in saved.items():
            if not name.startswith('_'):
                try: driver.add_cookie({'name': name, 'value': value})
                except: pass

        print('[dashboard-modules] navigation → /app/dashboard', flush=True)
        driver.get(HTB_BASE + '/app/dashboard')

        # Attendre les premiers modules (jusqu'à 30s)
        try:
            WebDriverWait(driver, 30).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, "a[href*='/app/module/']"))
            )
        except Exception as e:
            print(f'[dashboard-modules] WebDriverWait: {e}', flush=True)

        # Scroller pour charger tous les modules (lazy loading)
        # Attendre qu'il y ait au moins quelques modules avant de commencer
        for _ in range(10):
            initial = len(driver.find_elements(By.CSS_SELECTOR, "a[href*='/app/module/']"))
            if initial > 0:
                break
            time.sleep(1)
        prev_count = -1
        for _ in range(20):  # max 20 scrolls
            driver.execute_script('window.scrollTo(0, document.body.scrollHeight)')
            time.sleep(1.5)
            new_count = len(driver.find_elements(By.CSS_SELECTOR, "a[href*='/app/module/']"))
            print(f'[dashboard-modules] scroll: {new_count} liens', flush=True)
            if new_count == prev_count:
                break  # plus rien à charger
            prev_count = new_count

        current_url = driver.current_url
        page_title = driver.title
        print(f'[dashboard-modules] URL: {current_url}', flush=True)
        print(f'[dashboard-modules] titre: {page_title}', flush=True)

        if 'login' in current_url or 'account.hackthebox.com' in current_url:
            print('[dashboard-modules] session expirée - reconnectez-vous', flush=True)
            driver.quit()
            with _lock: _state['status'] = 'logged_in'
            return

        if 'Rate Limited' in page_title or 'Take it Slow' in driver.page_source[:500]:
            print('[dashboard-modules] rate limited', flush=True)
            driver.quit()
            with _lock: _state['status'] = 'logged_in'
            return

        # Sauvegarder le HTML pour debug
        debug_html_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../runtime/debug_dashboard.html')
        try:
            with open(debug_html_path, 'w', encoding='utf-8') as f:
                f.write(driver.page_source)
            print(f'[dashboard-modules] HTML sauvegardé → {debug_html_path}', flush=True)
        except Exception as e:
            print(f'[dashboard-modules] erreur sauvegarde HTML: {e}', flush=True)

        # Extraire modules via JS (h2 dans le container parent du lien, pas à l'intérieur)
        modules_js = driver.execute_script('''
            var links = document.querySelectorAll("a[href*='/app/module/']");
            var results = [];
            var seen = {};
            for (var i = 0; i < links.length; i++) {
                var a = links[i];
                var href = a.getAttribute('href') || '';
                var match = href.match(/\\/app\\/module\\/(\\d+)/);
                if (!match) continue;
                var id = match[1];
                if (seen[id]) continue;
                seen[id] = true;
                // Cherche h2 dans les containers parents (jusqu'à 6 niveaux)
                var el = a.parentElement;
                var title = null;
                for (var j = 0; j < 6; j++) {
                    if (!el) break;
                    var h2 = el.querySelector('h2');
                    if (h2 && h2.textContent.trim()) {
                        title = h2.textContent.trim();
                        break;
                    }
                    el = el.parentElement;
                }
                if (title) results.push({id: id, title: title});
            }
            return results;
        ''')

        print(f'[dashboard-modules] {len(modules_js) if modules_js else 0} modules JS', flush=True)

        seen = set()
        modules = []
        for item in (modules_js or []):
            mod_id = str(item.get('id', ''))
            mod_title = (item.get('title') or '').strip()
            if mod_id and mod_title and mod_id not in seen:
                seen.add(mod_id)
                modules.append({'id': mod_id, 'title': mod_title, 'url': f'{HTB_BASE}/app/module/{mod_id}'})

        # Fallback regex sur page_source si JS n'a rien trouvé
        if not modules:
            print('[dashboard-modules] fallback regex page_source', flush=True)
            ids_found = re.findall(r'/app/module/(\d+)', driver.page_source)
            for mod_id in dict.fromkeys(ids_found):  # dédoublonner en préservant l'ordre
                if mod_id not in seen:
                    seen.add(mod_id)
                    modules.append({'id': mod_id, 'title': f'Module {mod_id}', 'url': f'{HTB_BASE}/app/module/{mod_id}'})

        driver.quit()
        print(f'[dashboard-modules] → {len(modules)} modules uniques', flush=True)

        if modules:
            with open(DASHBOARD_CACHE_FILE, 'w') as f:
                json.dump({'modules': modules}, f)
            print('[dashboard-modules] cache sauvegardé', flush=True)
        else:
            print('[dashboard-modules] 0 modules — session expirée?', flush=True)

    except Exception as e:
        import traceback
        traceback.print_exc()
    finally:
        with _lock:
            _state['status'] = 'logged_in'


def _fetch_dashboard_modules():
    if os.path.exists(DASHBOARD_CACHE_FILE):
        try:
            with open(DASHBOARD_CACHE_FILE) as f:
                cached = json.load(f)
            if cached.get('modules') and len(cached['modules']) > 0:
                return cached
        except:
            pass
    return {'error': 'no_cache'}


def _fetch_path_modules():
    # Servir depuis le cache si disponible
    if os.path.exists(MODULES_CACHE_FILE):
        try:
            with open(MODULES_CACHE_FILE) as f:
                cached = json.load(f)
            if cached.get('modules') and len(cached['modules']) > 0:
                print(f'[path-modules] cache hit → {len(cached["modules"])} modules')
                return cached
        except:
            pass

    # Pas de cache → demander à l'utilisateur de se reconnecter
    return {'error': 'no_cache', 'hint': 'Reconnectez-vous via le bouton Login pour charger les modules'}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # Silence access logs

    def _json(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', len(body))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.end_headers()

    def do_POST(self):
        if self.path == '/login':
            with _lock: _state['status'] = 'browser_open'
            threading.Thread(target=_login_flow, daemon=True).start()
            self._json({'status': 'browser_opened'})
        elif self.path == '/refresh-path-modules':
            try:
                if os.path.exists(MODULES_CACHE_FILE):
                    os.remove(MODULES_CACHE_FILE)
            except: pass
            with _lock: _state['status'] = 'browser_open'
            threading.Thread(target=_scrape_modules_flow, daemon=True).start()
            self._json({'status': 'browser_opened'})
        elif self.path == '/refresh-dashboard-modules':
            content_length = int(self.headers.get('Content-Length', 0))
            body = {}
            if content_length:
                try: body = json.loads(self.rfile.read(content_length))
                except: pass
            force = body.get('force', False)
            if not force:
                cached = _fetch_dashboard_modules()
                if cached.get('modules'):
                    self._json({'status': 'cached'})
                    return
            with _lock: _state['status'] = 'browser_open'
            threading.Thread(target=_scrape_dashboard_modules_flow, daemon=True).start()
            self._json({'status': 'browser_opened'})
        else:
            self._json({'error': 'not found'}, 404)

    def do_GET(self):
        if self.path == '/status':
            with _lock:
                st = _state['status']
                browser_open = st == 'browser_open'

            logged_in = False
            path_id = None
            if os.path.exists(COOKIE_FILE):
                try:
                    with open(COOKIE_FILE) as f:
                        cookies = json.load(f)
                    logged_in = bool(cookies.get('htb_academy_session'))
                    path_id = cookies.get('_pathId')
                except: pass

            has_cache = os.path.exists(MODULES_CACHE_FILE)
            self._json({'loggedIn': logged_in, 'browserOpen': browser_open, 'pathId': path_id, 'status': st, 'hasModulesCache': has_cache})

        elif self.path == '/path-modules':
            self._json(_fetch_path_modules())
        elif self.path == '/dashboard-modules':
            self._json(_fetch_dashboard_modules())

        else:
            self._json({'error': 'not found'}, 404)


if __name__ == '__main__':
    server = HTTPServer(('localhost', 5001), Handler)
    print('[auth_server] Listening on http://localhost:5001')
    server.serve_forever()
