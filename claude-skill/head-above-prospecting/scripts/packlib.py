"""Checks for one prospect in a pack (shared by check_pack.py and add_prospect.py)."""
import re


def digits(s):
    return re.sub(r"\D", "", s or "")


def check_prospect(p, label):
    """Returns (problems, warnings) for one prospect dict."""
    problems, warnings = [], []
    if not isinstance(p, dict) or not (p.get("name") or "").strip():
        return [f"{label}: name is required."], []
    fs = p.get("fitScore")
    if not isinstance(fs, (int, float)) or not 0 <= fs <= 100:
        problems.append(f"{label}: fitScore must be a number 0-100.")
    r = p.get("research")
    if not isinstance(r, dict):
        warnings.append(f"{label}: no research section (it will be added without research).")
        return problems, warnings
    report = r.get("report") or ""
    low = report.lower()
    if len(report) < 150:
        warnings.append(f"{label}: the research write-up is very short.")
    if len(report) > 4000:
        warnings.append(f"{label}: the write-up is long; keep it to the short format to save usage.")
    if "http" not in low:
        problems.append(f"{label}: the write-up has no source links.")
    ph = digits(p.get("phone"))[-10:]
    if ph and ph not in digits(report):
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
    return problems, warnings
