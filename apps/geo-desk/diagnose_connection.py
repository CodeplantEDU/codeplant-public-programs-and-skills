"""Read-only connectivity diagnostics. Never print credentials or proxy URLs."""
import json
import socket
import ssl
import time
from urllib.request import urlopen, getproxies
from urllib.error import HTTPError, URLError
import server

print('proxy_protocols:', ','.join(getproxies().keys()) or 'none')
try:
    print('dns:', socket.gethostbyname('api.openai.com'))
except OSError as exc:
    print('dns_error:', type(exc).__name__, 'errno=', exc.errno, 'winerror=', getattr(exc, 'winerror', None))
start = time.monotonic()
try:
    with urlopen('https://api.openai.com/v1/models', timeout=15) as response:
        print('unauth_http:', response.status)
except HTTPError as exc:
    print('unauth_http:', exc.code)
except (URLError, OSError) as exc:
    reason = getattr(exc, 'reason', exc)
    print('network_error:', type(reason).__name__, 'errno=', getattr(reason, 'errno', None), 'winerror=', getattr(reason, 'winerror', None), 'certificate=', getattr(reason, 'verify_message', None))
print('elapsed:', round(time.monotonic() - start, 2))
if not server.DB.is_file():
    print('settings: not initialized; run start.ps1 first')
    raise SystemExit(0)
config = server.settings_snapshot()
print('key_configured:', bool(config.get('api_key')), 'model:', config.get('model'))
if config.get('api_key'):
    try:
        result = server.openai('models', server.protect(config['api_key'], True))
        print('authenticated_models:', len(result.get('data', [])), 'selected_model_available:', config.get('model') in {m['id'] for m in result.get('data', [])})
    except (ValueError, OSError, RuntimeError) as exc:
        print('authenticated_error:', str(exc))
