"""Check a prospect pack before sending it. Usage: python3 scripts/check_pack.py prospects.json"""
import json
import re
import sys

def digits(s):
    return re.sub(r"\D", "", s or "")

def main(path):
    with open(path, encoding="utf-8") as f:
        try:
            pack = json.load(f)
        except ValueError as e:
            print("INVALID JSON:", e)
            return 1
    problems, warnings = [], []
    prospects = pack.get("prospects")
    if not isinstance(prospects, list) or not prospects:
        print('INVALID: the pack needs a non-empty "prospects" list.')
        return 1
    if len(prospects) > 50:
        problems.append("More than 50 prospects: split into batches of up to 15.")
    seen = set()
    for i, p in enumerate(prospects, 1):
        name = (p.get("name") or "").strip()
        label = f"#{i} {name or '(no name)'}"
        if not name:
            problems.append(f"{label}: name is required.")
            continue
        key = name.lower()
        if key in seen:
            problems.append(f"{label}: listed twice.")
        seen.add(key)
        fs = p.get("fitScore")
        if not isinstance(fs, (int, float)) or not 0 <= fs <= 100:
            problems.append(f"{label}: fitScore must be a number 0-100.")
        r = p.get("research")
        if not isinstance(r, dict):
            warnings.append(f"{label}: no research section (it will be added without research).")
            continue
        report = (r.get("report") or "")
        low = report.lower()
        if len(report) < 200:
            warnings.append(f"{label}: the research write-up is very short.")
        if "http" not in low:
            problems.append(f"{label}: the write-up has no source links.")
        rd = digits(report)
        ph = digits(p.get("phone"))[-10:]
        if ph and ph not in rd:
            problems.append(f"{label}: phone {p.get('phone')} isn't in the write-up (the CRM would drop it). Add it with its source.")
        site = re.sub(r"^https?://(www\.)?", "", (p.get("website") or "").lower()).split("/")[0]
        if site and site not in low:
            problems.append(f"{label}: website {site} isn't in the write-up (the CRM would drop it).")
        for c in p.get("contacts") or []:
            cn = (c.get("name") or "").strip()
            if cn and cn.lower() not in low:
                problems.append(f"{label}: contact {cn} isn't named in the write-up (the CRM would drop them).")
            em = (c.get("email") or "").strip().lower()
            if em and em not in low:
                problems.append(f"{label}: email {em} isn't in the write-up. Only use addresses a source publishes.")
        if len(r.get("discoveryQuestions") or []) > 5:
            warnings.append(f"{label}: more than 5 discovery questions (only 5 are kept).")
        if r.get("match") not in ("confirmed", "not_confirmed"):
            problems.append(f'{label}: research.match must be "confirmed" or "not_confirmed".')
    for w in warnings:
        print("WARNING:", w)
    for pr in problems:
        print("FIX:", pr)
    print(f"{len(prospects)} prospects checked: {len(problems)} to fix, {len(warnings)} warnings.")
    return 1 if problems else 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1]) if len(sys.argv) > 1 else print(__doc__) or 2)
