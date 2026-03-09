"""Parse and write TiddlyWiki tiddler files (.tid and .json formats).

.tid format:
    field: value
    field: value
                        <- blank line separator
    body text here

.json format (used when fields contain newlines):
    [{"title": "...", "text": "...", ...}]
"""

from __future__ import annotations

import json
from pathlib import Path

from .models import Command, CommandStatus

TIDDLER_EXTENSIONS = {".tid", ".json"}


def parse_tiddler_file(file_path: Path) -> dict[str, str]:
    """Parse a .tid or .json tiddler file into a field dict."""
    raw = file_path.read_text(encoding="utf-8")
    if file_path.suffix == ".json":
        return parse_json_tiddler(raw)
    return parse_tid_string(raw)


def parse_json_tiddler(raw: str) -> dict[str, str]:
    """Parse a JSON tiddler file. TW saves as [{...}] array with one entry."""
    data = json.loads(raw)
    if isinstance(data, list) and len(data) > 0:
        return {k: str(v) for k, v in data[0].items()}
    if isinstance(data, dict):
        return {k: str(v) for k, v in data.items()}
    return {}


def write_tiddler_file(file_path: Path, fields: dict[str, str]) -> None:
    """Write fields back to the tiddler file, preserving original format."""
    file_path.parent.mkdir(parents=True, exist_ok=True)
    if file_path.suffix == ".json":
        text = json.dumps([fields], indent=4, ensure_ascii=False) + "\n"
    else:
        text = fields_to_tid_string(fields)
    file_path.write_text(text, encoding="utf-8")


def parse_tid_string(raw: str) -> dict[str, str]:
    """Parse a .tid-formatted string into a field dict."""
    fields: dict[str, str] = {}
    lines = raw.split("\n")

    body_start = 0
    for i, line in enumerate(lines):
        if line.strip() == "":
            body_start = i + 1
            break
        colon = line.find(": ")
        if colon == -1:
            # No colon-space found — treat as start of body (malformed header)
            body_start = i
            break
        key = line[:colon].strip()
        value = line[colon + 2:]
        fields[key] = value
    else:
        # No blank line found — entire file is headers, no body
        body_start = len(lines)

    body = "\n".join(lines[body_start:])
    # Strip single trailing newline (TW convention)
    if body.endswith("\n"):
        body = body[:-1]
    if body:
        fields["text"] = body

    return fields


def fields_to_tid_string(fields: dict[str, str]) -> str:
    """Convert a field dict to .tid format string."""
    body = fields.get("text", "")
    header_fields = {k: v for k, v in fields.items() if k != "text"}

    # Standard field ordering: title first, then type, then rest alphabetically
    priority = ["title", "type", "tags", "created", "modified"]
    ordered = []
    for key in priority:
        if key in header_fields:
            ordered.append((key, header_fields.pop(key)))
    for key in sorted(header_fields):
        ordered.append((key, header_fields[key]))

    lines = [f"{k}: {v}" for k, v in ordered]
    lines.append("")  # blank separator
    lines.append(body)
    if not body.endswith("\n"):
        lines.append("")  # trailing newline
    return "\n".join(lines)


def fields_to_command(fields: dict[str, str], file_path: Path) -> Command:
    """Convert parsed tiddler fields into a Command dataclass."""
    status_str = fields.get("status", "pending")
    try:
        status = CommandStatus(status_str)
    except ValueError:
        status = CommandStatus.PENDING

    return Command(
        title=fields.get("title", ""),
        target=fields.get("target", ""),
        command_text=fields.get("command-text", ""),
        source=fields.get("source", ""),
        status=status,
        text=fields.get("text", ""),
        created=fields.get("created", ""),
        modified=fields.get("modified", ""),
        file_path=file_path,
        fields=fields,
    )


# Backwards-compatible aliases
parse_tid = parse_tiddler_file
write_tid = write_tiddler_file
