"""Dummy reply service — replies "externally processed!" to any @Target command.

Setup (once):
    conda env create -f ../environment.yml
    conda activate tw-connector

Usage:
    python dummy-reply.py

Watches ext-outbox/ for any text-command, replies with a fixed string.
Press Ctrl+C to stop.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tw_connector import Command, Connector, ConnectorConfig, Reply

WIKI_PATH = Path(__file__).resolve().parent.parent.parent.parent.parent.parent.parent
# ↑ examples -> python -> scripts -> ext-connect -> rimir -> plugins -> dev-wiki


def handle_any(command: Command) -> Reply:
    print(f"  Received: @{command.target} {command.command_text}")
    print(f"  Source:   {command.source}")
    print(f"  Context:  {command.context[:200] if command.context else '(none)'}...")
    return Reply(text=f"externally processed: {command.command_text}\n\n---\n\nRendered context:\n\n{command.context or '(no context)'}")


def main():
    config = ConnectorConfig(wiki_path=WIKI_PATH, log_level="INFO")

    print(f"Wiki path: {config.wiki_path}")
    print(f"Outbox:    {config.outbox_path}")
    print()

    conn = Connector(config)
    conn.on_any(handle_any)
    conn.start()


if __name__ == "__main__":
    main()
