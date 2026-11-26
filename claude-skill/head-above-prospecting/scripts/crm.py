"""Shared helpers: read config.json and talk to the Head Above CRM (Python standard library only)."""
import json
import os
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG = os.path.join(HERE, "..", "config.json")


def load_config():
    try:
        with open(CONFIG, encoding="utf-8") as f:
            cfg = json.load(f)
    except (OSError, ValueError):
        cfg = {}
    url = str(cfg.get("appUrl") or "").strip().rstrip("/")
    key = str(cfg.get("apiKey") or "").strip()
    if not url.startswith("http") or "PASTE" in url:
        url = ""
    if not key.startswith("had_"):
        key = ""
    return url, key


def post(path, payload):
    """POST JSON to the CRM. Returns (status, body dict). Never prints the key."""
    url, key = load_config()
    if not url or not key:
        print("NOT_CONFIGURED: config.json has no CRM address or key. Hand the user the JSON file to import by hand.")
        sys.exit(3)
    req = urllib.request.Request(
        url + path,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + key, "User-Agent": "head-above-prospecting-skill"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            return r.status, json.loads(r.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read().decode("utf-8") or "{}")
        except ValueError:
            body = {}
        if e.code in (403, 407) and not body:
            print("NETWORK_BLOCKED: this environment can't reach " + url + ". Hand the user the JSON file to import by hand.")
            sys.exit(4)
        return e.code, body
    except (urllib.error.URLError, OSError) as e:
        print("NETWORK_BLOCKED: couldn't reach the CRM (" + str(getattr(e, "reason", e)) + "). Hand the user the JSON file to import by hand.")
        sys.exit(4)
