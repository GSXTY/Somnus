"""OAuth authorization-code and refresh flow for the paired MCP connection."""

import base64
import hashlib
from html import escape
import json
import re
import time
from urllib.parse import urlencode, urlsplit

from fastapi import Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from .store import digest, token


STABLE_REDIRECT = 'https://chatgpt.com/connector_platform_oauth_redirect'
SCOPE = 'somnus.dot'
ACCESS_SECONDS = 3600


def allowed_redirect(uri, local_dev):
    if not isinstance(uri, str) or len(uri) > 256:
        return False
    if uri == STABLE_REDIRECT:
        return True
    if not local_dev:
        return False
    try:
        url = urlsplit(uri)
        return (url.scheme == 'http' and url.hostname in ('127.0.0.1', 'localhost')
                and bool(url.port) and not (url.username or url.password or url.query or url.fragment))
    except ValueError:
        return False


def error(code, status=400):
    return JSONResponse({'error': code}, status_code=status)


def callback(uri, issuer, state, **values):
    return RedirectResponse(uri + '?' + urlencode({**values, 'state': state, 'iss': issuer}), status_code=303)


def install_oauth(app, store, issuer, local_dev, json_body, form_body, throttle):
    resource = issuer + '/mcp'

    @app.get('/.well-known/oauth-protected-resource/mcp')
    @app.get('/.well-known/oauth-protected-resource')
    async def protected_resource():
        return {'resource': resource, 'authorization_servers': [issuer],
                'bearer_methods_supported': ['header'], 'scopes_supported': [SCOPE]}

    @app.get('/.well-known/oauth-authorization-server')
    async def authorization_server():
        return {'issuer': issuer, 'authorization_endpoint': issuer + '/oauth/authorize',
                'token_endpoint': issuer + '/oauth/token', 'registration_endpoint': issuer + '/oauth/register',
                'response_types_supported': ['code'], 'grant_types_supported': [
                    'authorization_code', 'refresh_token',
                ], 'token_endpoint_auth_methods_supported': ['none'],
                'code_challenge_methods_supported': ['S256'], 'scopes_supported': [SCOPE],
                'authorization_response_iss_parameter_supported': True}

    @app.post('/oauth/register')
    async def register(request: Request):
        throttle(request, 'register', 30)
        data = await json_body(request)
        redirects = data.get('redirect_uris')
        if not isinstance(redirects, list) or not 1 <= len(redirects) <= 4 or not all(
                allowed_redirect(uri, local_dev) for uri in redirects):
            return error('invalid_redirect_uri')
        if data.get('token_endpoint_auth_method', 'none') != 'none':
            return error('invalid_client_metadata')
        client = token('client_')
        with store.transaction() as db:
            row = db.execute('SELECT id FROM clients WHERE redirects=? LIMIT 1', (json.dumps(redirects),)).fetchone()
            if row:
                client = row['id']
            else:
                db.execute('INSERT INTO clients VALUES (?,?)', (client, json.dumps(redirects)))
        return JSONResponse({'client_id': client, 'redirect_uris': redirects,
                             'token_endpoint_auth_method': 'none',
                             'grant_types': ['authorization_code', 'refresh_token'],
                             'response_types': ['code'], 'scope': SCOPE}, status_code=201)

    def validate_authorization(params):
        client, uri = params.get('client_id'), params.get('redirect_uri')
        if not allowed_redirect(uri, local_dev) or not client or len(client) > 100:
            return False
        with store.transaction() as db:
            row = db.execute('SELECT redirects FROM clients WHERE id=?', (client,)).fetchone()
        return bool(row and uri in json.loads(row['redirects']))

    @app.api_route('/oauth/authorize', methods=['GET', 'POST'])
    async def authorize(request: Request):
        params = dict(request.query_params) if request.method == 'GET' else await form_body(request)
        if not validate_authorization(params):
            return error('invalid_request')
        uri, state = params['redirect_uri'], params.get('state', '')
        if not state or len(state) > 1024:
            return error('invalid_request')
        challenge = params.get('code_challenge', '')
        if (params.get('response_type') != 'code' or params.get('code_challenge_method') != 'S256'
                or not re.fullmatch(r'[A-Za-z0-9_-]{43}', challenge)
                or params.get('resource', resource) != resource
                or params.get('scope', SCOPE) not in ('', SCOPE)):
            return callback(uri, issuer, state, error='invalid_request')
        if request.method == 'GET':
            fields = ('client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method',
                      'response_type', 'resource', 'scope')
            hidden = ''.join(f'<input type="hidden" name="{key}" value="{escape(params[key], quote=True)}">'
                             for key in fields if key in params)
            return HTMLResponse(
                '<!doctype html><html lang="en"><meta charset="utf-8"><title>Connect Somnus</title>'
                '<main><h1>Connect Somnus to ChatGPT</h1><p>Enter the one-time code shown in Somnus.</p>'
                '<form method="post" action="/oauth/authorize">' + hidden +
                '<label>Pairing code <input name="pairing_code" required autocomplete="off" maxlength="64"></label>'
                '<button type="submit">Connect</button></form></main></html>',
                headers={'Content-Security-Policy': "default-src 'none'; form-action 'self'; frame-ancestors 'none'",
                         'Referrer-Policy': 'no-referrer'},
            )
        throttle(request, 'authorize', 30)
        pairing_code = params.get('pairing_code', '').strip()
        if not re.fullmatch(r'[A-Za-z0-9_-]{32}', pairing_code):
            return callback(uri, issuer, state, error='access_denied')
        code, now = token('oauth_'), time.time()
        with store.transaction() as db:
            row = db.execute("""SELECT id FROM pairs WHERE pairing_code=? AND code_expires>? AND dot IS NULL""",
                             (digest(pairing_code), now)).fetchone()
            if row is None:
                return callback(uri, issuer, state, error='access_denied')
            db.execute('DELETE FROM oauth_codes WHERE pair_id=? OR expires<=?', (row['id'], now))
            db.execute('UPDATE pairs SET pairing_code=NULL WHERE id=?', (row['id'],))
            db.execute('INSERT INTO oauth_codes VALUES (?,?,?,?,?,?)',
                       (digest(code), row['id'], params['client_id'], uri, challenge, now + 120))
        return callback(uri, issuer, state, code=code)

    @app.post('/oauth/token')
    async def exchange(request: Request):
        throttle(request, 'token', 90)
        form = await form_body(request)
        client = form.get('client_id')
        if not client or form.get('resource', resource) != resource:
            return error('invalid_request')
        grant = form.get('grant_type')
        now = time.time()
        with store.transaction() as db:
            if grant == 'authorization_code':
                verifier = form.get('code_verifier', '')
                if not re.fullmatch(r'[A-Za-z0-9._~-]{43,128}', verifier):
                    return error('invalid_grant')
                challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
                row = db.execute("""SELECT pair_id FROM oauth_codes
                                 WHERE code=? AND client_id=? AND redirect=? AND challenge=? AND expires>?""",
                                 (digest(form.get('code', '')), client, form.get('redirect_uri', ''), challenge, now)
                                 ).fetchone()
                if row is None:
                    return error('invalid_grant')
                pair = row['pair_id']
                db.execute('DELETE FROM oauth_codes WHERE code=?', (digest(form['code']),))
            elif grant == 'refresh_token':
                row = db.execute('SELECT id FROM pairs WHERE refresh=? AND oauth_client=? AND refresh_expires>?',
                                 (digest(form.get('refresh_token', '')), client, now)).fetchone()
                if row is None:
                    return error('invalid_grant')
                pair = row['id']
            else:
                return error('unsupported_grant_type')
            access, refresh = token('dot_'), token('refresh_')
            db.execute("""UPDATE pairs SET dot=?,dot_expires=?,refresh=?,refresh_expires=?,oauth_client=?
                          WHERE id=?""",
                       (digest(access), now + ACCESS_SECONDS, digest(refresh), now + 2592000, client, pair))
        return {'access_token': access, 'token_type': 'Bearer', 'expires_in': ACCESS_SECONDS,
                'refresh_token': refresh, 'scope': SCOPE}
