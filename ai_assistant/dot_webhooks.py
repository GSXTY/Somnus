import base64
from datetime import datetime, timezone
import hmac
import http.client
import ipaddress
import json
import socket
import time
from urllib.parse import urlsplit


FAKE_IP_SUBNET = ipaddress.ip_network("198.18.0.0/15")


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def iso(seconds):
    return datetime.fromtimestamp(seconds, tz=timezone.utc).isoformat(timespec="seconds")


def signed_headers(body, message_id, subscription_id, key):
    timestamp = str(int(time.time()))
    raw = message_id.encode() + b"." + timestamp.encode() + b"." + body
    signature = base64.b64encode(hmac.digest(key, raw, "sha256")).decode("ascii")
    return {"Content-Type": "application/json", "webhook-id": message_id,
            "webhook-timestamp": timestamp, "webhook-signature": "v1," + signature,
            "X-MCP-Subscription-Id": subscription_id}


class PublicHTTPSConnection(http.client.HTTPSConnection):
    def connect(self):
        addresses = socket.getaddrinfo(self.host, self.port, type=socket.SOCK_STREAM)
        hostname = self.host.lower().rstrip(".")
        trusted_dns = any(hostname == domain or hostname.endswith("." + domain)
                          for domain in ("chatgpt.com", "openai.com"))
        eligible = []
        for entry in addresses:
            address = ipaddress.ip_address(entry[4][0])
            if ((address.is_global and not address.is_multicast)
                    or (trusted_dns and address in FAKE_IP_SUBNET)):
                eligible.append(str(address))
        if not eligible or len(eligible) != len(addresses):
            raise CallbackAddressError("Callback DNS destination is not public")
        for address in eligible:
            try:
                sock = socket.create_connection((address, self.port), timeout=self.timeout)
            except OSError:
                continue
            self.sock = self._context.wrap_socket(sock, server_hostname=self.host)
            return
        raise OSError("Callback connection failed")


class CallbackAddressError(OSError):
    pass


def outbound(url, body, headers):
    callback = urlsplit(url)
    if (callback.scheme != "https" or not callback.hostname or callback.username
            or callback.password or callback.fragment or callback.port not in (None, 443)):
        raise ValueError("Invalid HTTPS callback")
    path = callback.path or "/"
    if callback.query:
        path += "?" + callback.query
    connection = PublicHTTPSConnection(callback.hostname, port=443, timeout=6)
    try:
        connection.request("POST", path, body=body, headers=headers)
        response = connection.getresponse()
        return response.status, response.read(4096)
    finally:
        connection.close()
