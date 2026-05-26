#!/usr/bin/env python3
"""
HTTPS server for RaceFlyer SK.
Serves index.html over HTTPS so the browser allows geolocation.

Run:
    python3 /home/pi/RaceFlyerSK/serve.py

Then open https://openplotter.local:8443 in your browser.
Accept the self-signed cert warning once (Advanced -> Proceed).
"""

import http.server
import ssl
import os

PORT = 8443
CERT = '/home/pi/ssl-certs/cert.pem'
KEY  = '/home/pi/ssl-certs/key.pem'

os.chdir(os.path.dirname(os.path.abspath(__file__)))

ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain(CERT, KEY)

server = http.server.HTTPServer(('0.0.0.0', PORT), http.server.SimpleHTTPRequestHandler)
server.socket = ctx.wrap_socket(server.socket, server_side=True)

print(f'Serving on https://openplotter.local:{PORT}')
server.serve_forever()
