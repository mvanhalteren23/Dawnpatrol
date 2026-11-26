"""Send the prospects waiting in the pack file to the Head Above CRM.
Usage: python3 scripts/send_pack.py PACK.json
After a successful send, they move to PACK.sent.json and PACK.json is emptied, so each send only
carries new ones. Output is kept short on purpose (it all goes into the conversation)."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from crm import post  # noqa: E402


def main(path):
    with open(path, encoding="utf-8") as f:
        pack = json.load(f)
    waiting = pack.get("prospects") or []
    if not waiting:
        print("Nothing waiting to send.")
        return 0
    status, body = post("/api/prospects/import", pack)
    if status != 200:
        print(f"IMPORT FAILED ({status}): {body.get('error', 'unknown error')}")
        return 1
    # Move what was sent out of the waiting file.
    sent_path = path[:-5] + ".sent.json" if path.endswith(".json") else path + ".sent"
    sent = {"format": pack.get("format"), "criteria": pack.get("criteria"), "prospects": []}
    if os.path.exists(sent_path):
        with open(sent_path, encoding="utf-8") as f:
            sent = json.load(f)
    sent["prospects"] = (sent.get("prospects") or []) + waiting
    with open(sent_path, "w", encoding="utf-8") as f:
        json.dump(sent, f, ensure_ascii=False, indent=1)
    pack["prospects"] = []
    with open(path, "w", encoding="utf-8") as f:
        json.dump(pack, f, ensure_ascii=False, indent=1)

    results = body.get("results", [])
    added = [r for r in results if r.get("status") == "added"]
    other = [r for r in results if r.get("status") != "added"]
    print(f"SENT: {len(added)} added, {body.get('alreadyInCrm', 0)} already in the CRM. Total sent this search: {len(sent['prospects'])}.")
    for r in added:
        print(f"+ {r.get('name')}" + (" (researched)" if r.get("researched") else "") + (f" — {r['message']}" if r.get("message") else ""))
    for r in other:
        print(f"= {r.get('name')}: " + (("already in CRM" + (f" as {r['matched']}" if r.get("matched") and r["matched"] != r.get("name") else "")) if r.get("status") == "exists" else r.get("message", "not added")))
    for p in body.get("problems", []):
        print("NOTE:", p)
    if body.get("review"):
        print("Review:", body["review"])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]) if len(sys.argv) > 1 else print(__doc__) or 2)
