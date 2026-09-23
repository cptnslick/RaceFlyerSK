"""Exercise the real Handler from serve.py over plain HTTP — no cert or Pi needed."""
import http.server, os, sys, tempfile, threading, urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(HERE, '..', 'serve.py')).read()
root = tempfile.mkdtemp()
open(os.path.join(root, 'index.html'), 'w').write('<h1>app</h1>')
body = src.split('ctx = ssl.SSLContext')[0]                 # drop TLS + serve_forever
body = body.replace("WEBROOT    = '/home/pi/www'", 'WEBROOT    = %r' % root)
body = body.replace("UPDATE_CMD = '/usr/local/bin/update-page.sh'", "UPDATE_CMD = 'true'")
ns = {}
exec(compile(body, 'serve.py', 'exec'), ns)

srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), ns['Handler'])
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = 'http://127.0.0.1:%d' % srv.server_address[1]
results = []
def check(label, ok, detail=None): results.append((label, bool(ok), detail))

def status(req):
    try:
        r = urllib.request.urlopen(req); return r.status, r.headers
    except urllib.error.HTTPError as e:
        return e.code, e.headers

code, h = status(base + '/index.html')
check('GET serves the app', code == 200, code)
check('Cache-Control: no-cache', h.get('Cache-Control') == 'no-cache', h.get('Cache-Control'))
check('Last-Modified sent', h.get('Last-Modified') is not None)
code, _ = status(urllib.request.Request(base + '/index.html', headers={'If-Modified-Since': h.get('Last-Modified')}))
check('unchanged file revalidates as 304', code == 304, code)
code, _ = status(urllib.request.Request(base + '/update', data=b''))
check('POST /update without header is refused', code == 403, code)
code, _ = status(urllib.request.Request(base + '/update', data=b'', headers={'X-Update-Request': '1'}))
check('POST /update with header runs the script', code == 200, code)
code, _ = status(urllib.request.Request(base + '/other', data=b'', headers={'X-Update-Request': '1'}))
check('POST elsewhere is 404', code == 404, code)
srv.shutdown()

failed = [r for r in results if not r[1]]
print('%s  serve  (%d/%d)' % ('FAIL' if failed else 'ok  ', len(results) - len(failed), len(results)))
for label, _, detail in failed:
    print('        ✗ %s  → %r' % (label, detail))
sys.exit(1 if failed else 0)
