#!/usr/bin/env python3
"""Writes the SDKs' enums from the API's schema (GET /api/schema).

    python3 sdk/tools/gen_enums.py                      # from sdk/schema.json (checked in)
    python3 sdk/tools/gen_enums.py --url https://c1.simmail.dev --save
                                                        # from a server (SIMMAIL_API_KEY), and refresh sdk/schema.json

Writes js/enums.js, js/enums.d.ts and python/simmail/enums.py. Every value
keeps its label, description and plan feature, so the SDKs can show them.
A few enums the schema does not describe (folders, roles, error codes, …)
are listed in EXTRA below. Do not edit the generated files by hand.
"""

import argparse
import json
import os
import re
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# (enum name, area, field, doc) for every enum field of the schema the SDKs name.
FROM_SCHEMA = [
    ("Temperament", "personas", "temperament", "How a person tends to answer."),
    ("Knows", "personas", "knows", "How much a person knows about their case."),
    ("Life", "personas", "life", "Whose hours a person's replies keep."),
    ("Length", "personas", "style.length", "How long a person writes."),
    ("Formality", "personas", "style.formality", "How formally a person writes."),
    ("MailClient", "personas", "style.client", "A person's mail program: how their mail looks."),
    ("LinkHabit", "personas", "style.links", "Whether a person clicks links in mail."),
    ("SpamFilter", "personas", "style.filter", "A person's provider's spam filter."),
    ("Access", "personas", "style.access", "How a person takes in mail."),
    ("Stance", "personas", "relations.stance", "How a person feels about a sender (it follows the conversation)."),
    ("BadKind", "recipients", "default.bad_kinds", "What a bad address does."),
    ("FailAt", "recipients", "default.fail_at", "When a bad address fails."),
    ("Stranger", "recipients", "default.stranger", "Who is behind a never-seen address."),
    ("MailboxStatus", "recipients", "status", "A fixed outcome for one address as a recipient (ok clears it)."),
    ("FaultKind", "faults", "kind", "What a fault rule does."),
    ("FaultStage", "faults", "stage", "When in the SMTP conversation a fault rule acts."),
    ("FaultScenario", "faults", "scenario", "Real providers' failures, ready made."),
    ("MissingSite", "links", "missing_site", "When a sender's website does not exist."),
    ("LocalLinks", "links", "local_links", "Links to your own machine or network."),
    ("StreamKind", "world", "streams.kind", "What an inbound stream of the World sends."),
    ("AiMode", "ai", "mode", "AI writing on or off."),
    ("EventType", "webhooks", "events", "Event types, for waits, the event stream and webhooks (a name ending in * matches a prefix)."),
    ("JobKind", "jobs", "kind", "What a planned job is."),
    ("JobState", "jobs", "state", "Where a job stands."),
]

# Enums the schema does not describe: (name, doc, [(value, label, description)]).
EXTRA = [
    ("Folder", "Common folders (any folder name works too).", [
        ("INBOX", "Inbox", ""), ("Sent", "Sent", ""), ("Drafts", "Drafts", ""), ("Archive", "Archive", ""), ("Trash", "Trash", ""), ("Junk", "Junk", "")]),
    ("Protocol", "Which protocol a login test tries.", [("smtp", "SMTP", ""), ("imap", "IMAP", "")]),
    ("Role", "A role in a universe.", [("viewer", "Viewer", "Reads"), ("member", "Member", "Reads and writes"), ("admin", "Admin", "Also settings and logins"), ("owner", "Owner", "Also deletes the universe")]),
    ("PersonaSource", "Where a persona came from.", [("api", "API", ""), ("case", "Case", ""), ("stranger", "Stranger", ""), ("world", "World", ""), ("mail", "Learned from mail", ""), ("config", "Configuration file", "")]),
    ("StoryBy", "Who wrote a case's story.", [("ai", "AI", ""), ("template", "Template", ""), ("edited", "Edited by hand", "")]),
    ("EventAlias", "Friendlier names the event wait accepts for common events.", [
        ("delivered", "Delivered", "mail.delivered"), ("received", "Received", "persona.received"), ("replied", "Replied", "persona.sent"),
        ("sent", "Sent", "persona.sent"), ("declined", "Declined", "persona.ignored"), ("ignored", "Ignored", "persona.ignored"),
        ("junked", "Junked", "persona.junked"), ("bounced", "Bounced", "persona.bounced"), ("clicked", "Clicked", "link.opened"),
        ("opened_link", "Opened a link", "link.opened"), ("promised", "Promised", "persona.promised"), ("rescued", "Rescued", "persona.rescued")]),
    ("ErrorCode", "The code every error answer carries.", [
        ("bad_request", "Bad request", "400"), ("invalid_value", "Invalid value", "400: a field's value is not allowed (see allowed)"),
        ("invalid_regex", "Invalid regular expression", "400"), ("unauthorized", "Unauthorized", "401"), ("not_in_plan", "Not in the plan", "402"),
        ("forbidden", "Forbidden", "403"), ("not_found", "Not found", "404"), ("method_not_allowed", "Method not allowed", "405"),
        ("timeout", "Timeout", "408"), ("wait_timeout", "Wait timed out", "408: nothing matched (see near_misses)"),
        ("conflict", "Conflict", "409"), ("unexpected_email", "Unexpected email", "409: an email arrived where none was expected"),
        ("too_large", "Too large", "413"), ("unprocessable", "Unprocessable", "422"),
        ("idempotency_mismatch", "Idempotency key reused", "422: the key was used for a different request"),
        ("rate_limited", "Rate limited", "429"), ("internal_error", "Internal error", "500"), ("bad_gateway", "Bad gateway", "502"),
        ("unavailable", "Unavailable", "503")]),
]

SPECIAL = {"ooo": "OutOfOffice", "iphone": "IPhone", "ai": "Ai", "INBOX": "Inbox", "dsn": "Dsn"}


def words(value):
    return [w for w in re.split(r"[^A-Za-z0-9]+", str(value)) if w]


def pascal(value):
    if str(value) in SPECIAL:
        return SPECIAL[str(value)]
    return "".join(w[:1].upper() + w[1:] for w in words(value))


PY_SPECIAL = {"ooo": "OUT_OF_OFFICE"}


def upper(value):
    if str(value) in PY_SPECIAL:
        return PY_SPECIAL[str(value)]
    return "_".join(w.upper() for w in words(value))


def load(args):
    if args.url:
        req = urllib.request.Request(args.url.rstrip("/").removesuffix("/api") + "/api/schema", headers={"Accept": "application/json"})
        if os.environ.get("SIMMAIL_API_KEY"):
            req.add_header("Authorization", "Bearer " + os.environ["SIMMAIL_API_KEY"])
        with urllib.request.urlopen(req, timeout=30) as r:
            schema = json.load(r)
        if args.save:
            with open(os.path.join(ROOT, "schema.json"), "w") as f:
                json.dump(schema, f, indent=2)
                f.write("\n")
        return schema
    with open(args.file or os.path.join(ROOT, "schema.json")) as f:
        return json.load(f)


def enums(schema):
    out = []
    for name, area, fld, doc in FROM_SCHEMA:
        f = schema["areas"][area]["fields"][fld]
        vals = [(v["value"], v.get("label") or "", v.get("description") or "", v.get("feature") or "") for v in f["values"]]
        out.append((name, doc, vals))
    for name, doc, vals in EXTRA:
        out.append((name, doc, [(v, l, d, "") for v, l, d in vals]))
    for name, _, vals in out:
        keys = [pascal(v[0]) for v in vals]
        if len(set(keys)) != len(keys):
            sys.exit(f"{name}: two values make the same member name: {keys}")
    return out


HEADER = "Generated by sdk/tools/gen_enums.py from GET /api/schema (version {version}). Do not edit by hand."


def js(schema, all_enums):
    lines = [f"// {HEADER.format(version=schema.get('version'))}",
             "//",
             "// Named values for every setting with a fixed set of choices. Each constant is the",
             "// API's plain string, so a method takes either: Temperament.Skeptical === \"skeptical\".",
             "// EnumInfo has each value's label, description and plan feature.", "",
             "const e = o => Object.freeze(o);", ""]
    info = {}
    for name, doc, vals in all_enums:
        lines.append(f"/** {doc} */")
        body = ", ".join(f"{pascal(v)}: {json.dumps(v)}" for v, *_ in vals)
        lines.append(f"export const {name} = e({{ {body} }});")
        info[name] = {str(v): {k: x for k, x in (("label", l), ("description", d), ("feature", ft)) if x} for v, l, d, ft in vals}
    lines += ["", "/** Each enum value's label, description and plan feature: EnumInfo.Temperament.skeptical.label. */",
              "export const EnumInfo = e(" + json.dumps(info, indent=2, ensure_ascii=False) + ");", "",
              "/** The label of a value, such as describe(\"Temperament\", \"skeptical\") → \"Skeptical\". */",
              "export function describe(enumName, value) {",
              "  const i = (EnumInfo[enumName] || {})[value];",
              "  return i ? i.label || String(value) : String(value);",
              "}", ""]
    return "\n".join(lines)


def dts(schema, all_enums):
    lines = [f"// {HEADER.format(version=schema.get('version'))}", "", "type OneOf<T> = T[keyof T];", ""]
    for name, doc, vals in all_enums:
        lines.append(f"/** {doc} */")
        body = "; ".join(f"readonly {pascal(v)}: {json.dumps(v)}" for v, *_ in vals)
        lines.append(f"export declare const {name}: {{ {body} }};")
        open_ = name in ("Folder", "EventType")
        lines.append(f"export type {name} = OneOf<typeof {name}>{' | (string & {})' if open_ else ''};")
    lines += ["", "export interface EnumValueInfo { label?: string; description?: string; feature?: string }",
              "/** Each enum value's label, description and plan feature. */",
              "export declare const EnumInfo: { readonly [enumName: string]: { readonly [value: string]: EnumValueInfo } };",
              "/** The label of a value, such as describe(\"Temperament\", \"skeptical\"). */",
              "export declare function describe(enumName: string, value: string): string;", ""]
    return "\n".join(lines)


def py(schema, all_enums):
    names = [n for n, *_ in all_enums]
    lines = [f'"""{HEADER.format(version=schema.get("version"))}', "",
             "Named values for every setting with a fixed set of choices. Members are str",
             "subclasses equal to the API's strings, so a method takes either the member or the",
             'string: ``Temperament.SKEPTICAL == "skeptical"``. Each member has ``label``,',
             '``description`` and ``feature``."""', "", "from enum import Enum", "",
             "__all__ = [" + ", ".join(json.dumps(n) for n in names) + ", \"describe\"]", "", "",
             "class _Str(str, Enum):",
             "    def __str__(self) -> str:  # the API's string, in f-strings and URLs too",
             "        return str(self.value)", "",
             "    @property",
             "    def label(self) -> str:",
             "        return _INFO.get(type(self).__name__, {}).get(self.value, {}).get(\"label\") or str(self.value)", "",
             "    @property",
             "    def description(self) -> str:",
             "        return _INFO.get(type(self).__name__, {}).get(self.value, {}).get(\"description\", \"\")", "",
             "    @property",
             "    def feature(self) -> str:",
             "        \"\"\"The plan feature this value needs, if any.\"\"\"",
             "        return _INFO.get(type(self).__name__, {}).get(self.value, {}).get(\"feature\", \"\")", ""]
    info = {}
    for name, doc, vals in all_enums:
        lines += ["", f"class {name}(_Str):", f"    \"\"\"{doc}\"\"\""]
        for v, *_ in vals:
            lines.append(f"    {upper(v)} = {json.dumps(v)}")
        lines.append("")
        info[name] = {str(v): {k: x for k, x in (("label", l), ("description", d), ("feature", ft)) if x} for v, l, d, ft in vals}
    lines += ["", "_INFO = " + json.dumps(info, indent=4, ensure_ascii=False), "", "",
              "def describe(enum_name: str, value: str) -> str:",
              "    \"\"\"The label of a value, such as describe(\"Temperament\", \"skeptical\").\"\"\"",
              "    return _INFO.get(enum_name, {}).get(str(value), {}).get(\"label\") or str(value)", ""]
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", help="a simmail server to read GET /api/schema from")
    ap.add_argument("--file", help="a schema JSON file (default: sdk/schema.json)")
    ap.add_argument("--save", action="store_true", help="with --url: also refresh sdk/schema.json")
    args = ap.parse_args()
    schema = load(args)
    all_enums = enums(schema)
    for path, text in (("js/enums.js", js(schema, all_enums)), ("js/enums.d.ts", dts(schema, all_enums)),
                       ("python/simmail/enums.py", py(schema, all_enums))):
        with open(os.path.join(ROOT, path), "w") as f:
            f.write(text)
        print("wrote", path)


if __name__ == "__main__":
    main()
