"""Minimal working example for the TiddlyWiki connector.

Setup (once):
    conda env create -f environment.yml
    conda activate tw-connector

Usage:
    python example.py

Watches for @LLM text-commands in the wiki, echoes them back as replies.
Press Ctrl+C to stop.
"""

from pathlib import Path

from tw_connector import Command, Connector, ConnectorConfig, Reply


def handle_llm(command: Command) -> Reply:
    """Echo handler — returns the command text as-is."""
    print(f"  Target:  {command.target}")
    print(f"  Source:  {command.source}")
    print(f"  Command: {command.command_text}")
    if command.context:
        print(f"  Context: {command.context[:200]}...")
    print()

    return Reply(
        text=f"Echo reply to: {command.command_text}",
        # context defaults to [command.source] — links reply to the originating tiddler
    )


def main():
    config = ConnectorConfig(
        wiki_path=Path(__file__).resolve().parent.parent.parent.parent.parent.parent,
        # ↑ resolves to dev-wiki/ (python -> scripts -> ext-connect -> rimir -> plugins -> dev-wiki)
        log_level="INFO",
    )

    print(f"Wiki path: {config.wiki_path}")
    print(f"Outbox:    {config.outbox_path}")
    print()

    conn = Connector(config)
    conn.on("LLM", handle_llm)

    # For multiple targets:
    # conn.on("Dodo", handle_dodo)
    # conn.on_any(handle_fallback)  # catch-all

    conn.start()  # blocks until Ctrl+C


if __name__ == "__main__":
    main()
