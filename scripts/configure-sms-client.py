#!/usr/bin/env python3
"""Provision central SMS access without executing configuration or storing provider keys."""
import json
import os
from pathlib import Path
import re
import shlex
import tempfile
from urllib.parse import urlsplit

KEYS = ('LIGHTNAS_SMS_GATEWAY_URL', 'LIGHTNAS_SMS_GATEWAY_TOKEN')


def read_existing(path):
    values = {}
    if path.exists():
        for line in path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            key, separator, value = line.partition('=')
            if separator and key in KEYS:
                parts = shlex.split(value, comments=False)
                if len(parts) > 1:
                    raise ValueError('Invalid SMS environment file value')
                values[key] = parts[0] if parts else ''
    return values


def configure(path, environ):
    if path.is_symlink():
        raise ValueError('SMS configuration must not be a symlink')
    values = read_existing(path)
    provision = environ.get('LIGHTNAS_SMS_PROVISION_FILE', '')
    if provision:
        supplied = json.loads(Path(provision).read_text())
        if not isinstance(supplied, dict) or set(supplied) != set(KEYS):
            raise ValueError('SMS provisioning requires only the central service URL and appliance token')
        if not all(isinstance(value, str) for value in supplied.values()):
            raise ValueError('SMS provisioning values must be strings')
        values.update(supplied)
    overrides = {key: environ[key] for key in KEYS if key in environ}
    if overrides and set(overrides) != set(KEYS):
        raise ValueError('Provide both SMS gateway URL and appliance token together')
    values.update(overrides)
    url, token = (values.get(key, '').strip() for key in KEYS)
    if bool(url) != bool(token):
        raise ValueError('SMS gateway URL and appliance token must both be configured')
    if url:
        parsed = urlsplit(url)
        loopback = parsed.hostname in ('127.0.0.1', 'localhost', '::1')
        if (parsed.scheme != 'https' and not (parsed.scheme == 'http' and loopback)) or not parsed.hostname:
            raise ValueError('Central SMS URL requires HTTPS (HTTP is allowed only on loopback)')
        if parsed.username or parsed.password or parsed.query or parsed.fragment or re.search(r'[\s\\"\x00-\x1f]', url):
            raise ValueError('Central SMS URL must not contain credentials, queries or unsafe characters')
        if not re.fullmatch(r'[A-Za-z0-9._~+/=-]{16,512}', token):
            raise ValueError('Appliance SMS token must be 16-512 safe bearer-token characters')
    elif environ.get('LIGHTNAS_REQUIRE_SMS') == '1':
        raise ValueError('SMS is required: supply a provisioning file or both gateway settings')
    content = ('# Central LightNAS SMS access; no external provider credentials.\n'
               f'{KEYS[0]}="{url.rstrip("/")}"\n{KEYS[1]}="{token}"\n')
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.sms-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as output:
            os.fchmod(output.fileno(), 0o640)
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return bool(url)


if __name__ == '__main__':
    try:
        configured = configure(Path(os.environ.get('LIGHTNAS_SMS_CONFIG_FILE', '/etc/lightnas/sms.env')), os.environ)
        print('Central LightNAS SMS access configured; delivery requires the central service.' if configured else
              'SMS verification pending: supply LIGHTNAS_SMS_PROVISION_FILE or gateway URL/token. No provider credentials are stored on this appliance.')
    except (ValueError, OSError) as error:
        # Never print input values or parser exceptions that could contain credentials.
        print('Unable to provision SMS access. Check provisioning format, HTTPS URL, paired settings and file access.', file=__import__('sys').stderr)
        raise SystemExit(1)
