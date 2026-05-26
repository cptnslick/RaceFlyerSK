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

PORT    = 8443
CERT    = '/home/pi/ssl-certs/cert.pem'
KEY     = '/home/pi/ssl-certs/key.pem'
WEBROOT = '/home/pi/www'

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEBROOT, **kwargs)

ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain(CERT, KEY)

server = http.server.HTTPServer(('0.0.0.0', PORT), Handler)
server.socket = ctx.wrap_socket(server.socket, server_side=True)

print(f'Serving {WEBROOT} on https://openplotter.local:{PORT}')
server.serve_forever()
