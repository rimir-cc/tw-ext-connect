"""Data models for the TiddlyWiki connector."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path


class CommandStatus(Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    DONE = "done"
    ERROR = "error"


@dataclass(frozen=True)
class Command:
    """An inbound command extracted from a text-command tiddler."""

    title: str
    target: str
    command_text: str
    source: str
    status: CommandStatus
    text: str
    created: str
    modified: str
    file_path: Path
    fields: dict[str, str]
    context: str | None = None

    def with_context(self, context: str) -> Command:
        """Return a copy with the context field populated."""
        return Command(
            title=self.title,
            target=self.target,
            command_text=self.command_text,
            source=self.source,
            status=self.status,
            text=self.text,
            created=self.created,
            modified=self.modified,
            file_path=self.file_path,
            fields=self.fields,
            context=context,
        )


@dataclass
class Reply:
    """A reply to send back into the wiki via ext-connect."""

    text: str
    title: str | None = None
    profile: str | None = None
    context: list[str] | None = None
    fields: dict[str, str] | None = None


@dataclass
class ConnectorConfig:
    """Configuration for the Connector."""

    wiki_path: Path
    server_url: str = "http://localhost:8080"
    outbox_subdir: str = "ext-outbox"
    npx_command: str = "npx"
    poll_interval: float = 1.0
    render_timeout: int = 30
    import_timeout: int = 30
    log_level: str = "INFO"

    @property
    def outbox_path(self) -> Path:
        return self.wiki_path / "tiddlers" / self.outbox_subdir

    @property
    def tiddlers_path(self) -> Path:
        return self.wiki_path / "tiddlers"
