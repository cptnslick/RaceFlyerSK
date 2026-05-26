#!/usr/bin/env python3
"""
HTTPS server for RaceFlyer SK.
Serves index.html over HTTPS so the browser allows geolocation.

Setup (run once):
    openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 3650 -nodes \
      -subj "/CN=raspberrypi.local" \
      -addext "subjectAltName=DNS:raspberrypi.local,DNS:localhost,IP:127.0.0.1"

Run:
    python3 serve.py

Then open https://<pi-ip>:8443 in your browser.
Accept the self-signed cert warning once (Advanced → Proceed).
"""

import http.server
import ssl
import os

PORT = 8443
CERT = os.path.join(os.path.dirname(__file__), 'cert.pem')
KEY  = os.path.join(os.path.dirname(__file__), 'key.pem')

os.chdir(os.path.dirname(os.path.abspath(__file__)))

ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain(CERT, KEY)

server = http.server.HTTPServer(('0.0.0.0', PORT), http.server.SimpleHTTPRequestHandler)
server.socket = ctx.wrap_socket(server.socket, server_side=True)

print(f'Serving on https://0.0.0.0:{PORT}')
server.serve_forever()
