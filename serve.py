#!/usr/bin/env python3
"""
HTTPS server for RaceFlyer SK.
Serves /home/pi/www over HTTPS so the browser allows geolocation.

Run: python3 /home/pi/serve.py
Then open https://openplotter.local:8443
Accept the self-signed cert warning once (Advanced -> Proceed).
"""

import http.server
import ssl
import subprocess
import threading

PORT       = 8443
CERT       = '/home/pi/ssl-certs/cert.pem'
KEY        = '/home/pi/ssl-certs/key.pem'
WEBROOT    = '/home/pi/www'
UPDATE_CMD = '/usr/local/bin/update-page.sh'

# Serializes update runs; concurrent POSTs would race update-page.sh
# against itself while it writes into the webroot.
update_lock = threading.Lock()

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEBROOT, **kwargs)

    def do_POST(self):
        if self.path != '/update':
            self.send_response(404)
            self.end_headers()
            return
        # Custom header makes this a non-simple request: cross-origin pages
        # can't add it without passing a CORS preflight, which we never grant.
        if self.headers.get('X-Update-Request') != '1':
            self.send_response(403)
            self.end_headers()
            return
        if not update_lock.acquire(blocking=False):
            self._reply(409, 'Update already in progress')
            return
        try:
            result = subprocess.run(
                [UPDATE_CMD], capture_output=True, text=True, timeout=60
            )
            output = (result.stdout + result.stderr).strip()
        except Exception as e:
            output = f'Error: {e}'
        finally:
            update_lock.release()
        self._reply(200, output)

    def _reply(self, status, body):
        self.send_response(status)
        self.send_header('Content-Type', 'text/plain')
        self.end_headers()
        self.wfile.write(body.encode())

    def log_message(self, format, *args):
        pass

ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain(CERT, KEY)

# ThreadingHTTPServer: a 30s update run (or one slow client) must not
# block every other device on the boat from loading the page.
server = http.server.ThreadingHTTPServer(('0.0.0.0', PORT), Handler)
server.socket = ctx.wrap_socket(server.socket, server_side=True)

print(f'Serving {WEBROOT} on https://openplotter.local:{PORT}')
server.serve_forever()
