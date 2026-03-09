"""Main Connector class — the public API for external tools."""

from __future__ import annotations

import asyncio
import inspect
import json
import logging
import signal
import threading
import time
import traceback
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Callable

from .models import Command, CommandStatus, ConnectorConfig, Reply
from .tid import fields_to_command, parse_tid, write_tid
from .tw_cli import TiddlyWikiCLI
from .watcher import OutboxWatcher

logger = logging.getLogger("tw_connector")

HandlerFunc = Callable[[Command], Reply | None]


class Connector:
    """Watches for text-command tiddlers and dispatches them to registered handlers.

    Usage:
        config = ConnectorConfig(wiki_path=Path("dev-wiki"))
        conn = Connector(config)
        conn.on("LLM", my_handler)
        conn.start()  # blocks until Ctrl+C
    """

    def __init__(self, config: ConnectorConfig) -> None:
        self._config = config
        self._handlers: dict[str, tuple[HandlerFunc, bool]] = {}  # target -> (handler, auto_render)
        self._any_handler: tuple[HandlerFunc, bool] | None = None
        self._cli = TiddlyWikiCLI(
            wiki_path=config.wiki_path,
            npx_command=config.npx_command,
            render_timeout=config.render_timeout,
            import_timeout=config.import_timeout,
        )
        self._watcher: OutboxWatcher | None = None
        self._executor: ThreadPoolExecutor | None = None
        self._running = False
        self._stop_event = threading.Event()

        # Configure logging
        logging.basicConfig(
            level=getattr(logging, config.log_level.upper(), logging.INFO),
            format="%(asctime)s [%(name)s] %(levelname)s %(message)s",
            datefmt="%H:%M:%S",
        )

    def on(self, target: str, handler: HandlerFunc, *, auto_render_context: bool = True) -> None:
        """Register a handler for commands with a specific target.

        Args:
            target: The target name (e.g. "LLM"). Case-sensitive, matched against
                    the command's ``target`` field.
            handler: Callable that receives a Command and returns Reply or None.
            auto_render_context: If True (default), render TW context before calling handler.
        """
        self._handlers[target] = (handler, auto_render_context)

    def on_any(self, handler: HandlerFunc, *, auto_render_context: bool = True) -> None:
        """Register a catch-all handler for commands with no target-specific handler."""
        self._any_handler = (handler, auto_render_context)

    def start(self, *, blocking: bool = True) -> None:
        """Start watching the outbox and processing commands.

        Args:
            blocking: If True (default), blocks until Ctrl+C or stop() is called.
                      If False, returns immediately (watcher runs in background thread).
        """
        if self._running:
            return

        self._running = True
        self._stop_event.clear()
        self._executor = ThreadPoolExecutor(max_workers=4)

        self._watcher = OutboxWatcher(
            outbox_path=self._config.outbox_path,
            poll_interval=self._config.poll_interval,
            on_file_ready=self._on_file_ready,
        )

        # Catch up on pending commands that arrived while offline
        existing = self._watcher.scan_existing()
        pending = []
        for path in existing:
            try:
                fields = parse_tid(path)
                if fields.get("status") == CommandStatus.PENDING.value:
                    pending.append(path)
            except Exception:
                logger.debug("Skipping unreadable file: %s", path.name)

        if pending:
            logger.info("Catching up on %d pending command(s)", len(pending))
            for path in pending:
                self._on_file_ready(path)

        # Start live watcher
        self._watcher.start()
        logger.info("Connector started (targets: %s)", ", ".join(self._handlers) or "(any)")

        if blocking:
            self._block_until_stop()

    def stop(self) -> None:
        """Stop the watcher and wait for in-flight handlers to complete."""
        if not self._running:
            return
        self._running = False
        self._stop_event.set()

        if self._watcher:
            self._watcher.stop()
            self._watcher = None

        if self._executor:
            self._executor.shutdown(wait=True, cancel_futures=False)
            self._executor = None

        logger.info("Connector stopped")

    @property
    def is_running(self) -> bool:
        return self._running

    def render_context(self, command: Command) -> Command:
        """Render TW context for a command. Returns a new Command with context populated."""
        start = time.monotonic()
        context = self._cli.render_context(command.title)
        elapsed = time.monotonic() - start
        logger.info("Rendered context for %s (%.1fs)", command.title, elapsed)
        return command.with_context(context)

    def reply(self, command: Command, reply: Reply) -> str:
        """Send a reply back into the wiki. Uses POST API (preserves full resolution pipeline
        including profiles, rules, template actions). Falls back to CLI --import only if
        the server is unreachable.

        Returns the title of the created tiddler.
        """
        reply_json = self._build_reply_json(command, reply)
        title = self._post_reply(reply_json)
        if title is None:
            logger.info("Server unavailable, falling back to CLI import")
            title = self._cli.import_reply(reply_json)
        logger.info("Reply sent for %s -> %s", command.title, title)
        return title

    def update_status(self, command: Command, status: CommandStatus) -> None:
        """Update the status field on a command's .tid file."""
        if not command.file_path.exists():
            logger.warning("Cannot update status — file missing: %s", command.file_path)
            return

        fields = parse_tid(command.file_path)
        fields["status"] = status.value
        fields["modified"] = self._tw_timestamp()
        write_tid(command.file_path, fields)
        logger.debug("Status updated: %s -> %s", command.title, status.value)

    # --- Private methods ---

    def _on_file_ready(self, path: Path) -> None:
        """Called by the watcher when a .tid file is ready for processing."""
        try:
            fields = parse_tid(path)
        except Exception:
            logger.warning("Failed to parse %s", path.name, exc_info=True)
            return

        # Only process pending commands
        if fields.get("status") != CommandStatus.PENDING.value:
            return

        command = fields_to_command(fields, path)

        # Find handler
        handler_info = self._handlers.get(command.target)
        if handler_info is None:
            handler_info = self._any_handler
        if handler_info is None:
            logger.debug("No handler for target '%s', skipping: %s", command.target, command.title)
            return

        handler, auto_render = handler_info
        logger.info("Command received: %s (target=%s)", command.title, command.target)

        # Submit to thread pool
        if self._executor:
            self._executor.submit(self._process_command, command, handler, auto_render)

    def _process_command(
        self, command: Command, handler: HandlerFunc, auto_render: bool
    ) -> None:
        """Process a single command in a worker thread."""
        try:
            # Set status to processing
            self.update_status(command, CommandStatus.PROCESSING)

            # Auto-render context if requested
            if auto_render:
                command = self.render_context(command)

            # Call handler (sync or async)
            if inspect.iscoroutinefunction(handler):
                result = asyncio.run(handler(command))
            else:
                result = handler(command)

            # If handler returned a Reply, send it
            if isinstance(result, Reply):
                self.reply(command, result)
                self.update_status(command, CommandStatus.DONE)

        except Exception:
            logger.error("Handler error for %s:\n%s", command.title, traceback.format_exc())
            self.update_status(command, CommandStatus.ERROR)

    def _build_reply_json(self, command: Command, reply: Reply) -> dict:
        """Build the JSON payload for ext-connect import."""
        payload: dict = {"text": reply.text}

        if reply.title:
            payload["title"] = reply.title
        if reply.profile:
            payload["profile"] = reply.profile

        # Default context: link to the source tiddler (not the command tiddler)
        if reply.context is not None:
            payload["context"] = reply.context
        else:
            payload["context"] = [command.source]

        if reply.fields:
            payload["fields"] = reply.fields

        return payload

    def _post_reply(self, reply_json: dict) -> str | None:
        """Try to send reply via POST /api/ext-connect/put-tiddler. Returns title or None."""
        url = f"{self._config.server_url}/api/ext-connect/put-tiddler"
        data = json.dumps(reply_json).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            headers={
                "Content-Type": "application/json",
                "X-Requested-With": "TiddlyWiki",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                body = json.loads(resp.read().decode("utf-8"))
                title = body.get("title", "(unknown)")
                logger.debug("POST reply succeeded: %s", title)
                return title
        except (urllib.error.URLError, OSError, json.JSONDecodeError) as e:
            logger.debug("POST reply failed: %s", e)
            return None

    def _block_until_stop(self) -> None:
        """Block the main thread until stop() is called or SIGINT/SIGTERM received."""
        # Install signal handlers for graceful shutdown
        original_sigint = signal.getsignal(signal.SIGINT)
        original_sigterm = signal.getsignal(signal.SIGTERM)

        def _shutdown(signum, frame):
            logger.info("Shutdown signal received")
            self.stop()

        signal.signal(signal.SIGINT, _shutdown)
        signal.signal(signal.SIGTERM, _shutdown)

        try:
            while self._running:
                self._stop_event.wait(timeout=1.0)
        finally:
            signal.signal(signal.SIGINT, original_sigint)
            signal.signal(signal.SIGTERM, original_sigterm)

    @staticmethod
    def _tw_timestamp() -> str:
        """Generate a TiddlyWiki-format UTC timestamp: YYYYMMDDHHMMSSMMM."""
        import datetime

        now = datetime.datetime.now(datetime.timezone.utc)
        return now.strftime("%Y%m%d%H%M%S") + f"{now.microsecond // 1000:03d}"
