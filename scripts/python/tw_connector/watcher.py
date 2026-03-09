"""Watchdog-based observer for the ext-outbox directory."""

from __future__ import annotations

import logging
import threading
import time
from pathlib import Path
from typing import Callable

from watchdog.events import FileCreatedEvent, FileModifiedEvent, FileSystemEventHandler
from watchdog.observers.polling import PollingObserver

from .tid import TIDDLER_EXTENSIONS

logger = logging.getLogger("tw_connector")


class _TidEventHandler(FileSystemEventHandler):
    """Handles .tid file events with debouncing."""

    def __init__(
        self,
        on_file_ready: Callable[[Path], None],
        debounce_ms: float = 300,
    ) -> None:
        super().__init__()
        self._on_file_ready = on_file_ready
        self._debounce_s = debounce_ms / 1000.0
        self._pending: dict[str, threading.Timer] = {}
        self._lock = threading.Lock()

    def _schedule(self, path: Path) -> None:
        """Schedule a debounced callback for a file path."""
        key = str(path)
        with self._lock:
            if key in self._pending:
                self._pending[key].cancel()
            timer = threading.Timer(self._debounce_s, self._fire, args=[path, key])
            timer.daemon = True
            self._pending[key] = timer
            timer.start()

    def _fire(self, path: Path, key: str) -> None:
        with self._lock:
            self._pending.pop(key, None)
        if path.exists() and path.suffix in TIDDLER_EXTENSIONS:
            self._on_file_ready(path)

    def on_created(self, event: FileCreatedEvent) -> None:
        if not event.is_directory:
            path = Path(event.src_path)
            if path.suffix in TIDDLER_EXTENSIONS:
                logger.debug("File created: %s", path.name)
                self._schedule(path)

    def on_modified(self, event: FileModifiedEvent) -> None:
        if not event.is_directory:
            path = Path(event.src_path)
            if path.suffix in TIDDLER_EXTENSIONS:
                logger.debug("File modified: %s", path.name)
                self._schedule(path)

    def cancel_all(self) -> None:
        """Cancel all pending timers."""
        with self._lock:
            for timer in self._pending.values():
                timer.cancel()
            self._pending.clear()


class OutboxWatcher:
    """Watches the ext-outbox directory for new/modified .tid files.

    Resilient to directory deletion — if the outbox dir disappears, the watcher
    polls until it reappears, then re-attaches the observer and scans for any
    files that arrived while it was gone.
    """

    def __init__(
        self,
        outbox_path: Path,
        poll_interval: float,
        on_file_ready: Callable[[Path], None],
    ) -> None:
        self._outbox_path = outbox_path
        self._poll_interval = poll_interval
        self._on_file_ready = on_file_ready
        self._handler = _TidEventHandler(on_file_ready)
        self._observer: PollingObserver | None = None
        self._supervisor: threading.Thread | None = None
        self._stop_event = threading.Event()

    def start(self) -> None:
        """Start watching (non-blocking). Spawns a supervisor thread that keeps
        the observer alive across directory deletions."""
        self._stop_event.clear()
        self._supervisor = threading.Thread(target=self._supervise, daemon=True)
        self._supervisor.start()

    def stop(self) -> None:
        """Stop watching and cancel pending debounce timers."""
        self._stop_event.set()
        self._handler.cancel_all()
        self._stop_observer()
        if self._supervisor is not None:
            self._supervisor.join(timeout=5)
            self._supervisor = None

    def scan_existing(self) -> list[Path]:
        """Return existing .tid files in the outbox, sorted by modification time."""
        if not self._outbox_path.exists():
            return []
        files = sorted(
            [f for f in self._outbox_path.rglob("*") if f.suffix in TIDDLER_EXTENSIONS],
            key=lambda p: p.stat().st_mtime,
        )
        return files

    def _supervise(self) -> None:
        """Supervisor loop: ensures observer is running whenever the outbox dir exists."""
        was_missing = False

        while not self._stop_event.is_set():
            if self._outbox_path.exists():
                if self._observer is None:
                    if was_missing:
                        logger.info("Outbox directory reappeared, re-attaching watcher")
                        # Wait for syncer to finish writing all files
                        self._stop_event.wait(timeout=2.0)
                        if self._stop_event.is_set():
                            break
                        # Scan for files that arrived while we were down
                        for path in self.scan_existing():
                            self._on_file_ready(path)
                    self._start_observer()
                    was_missing = False
                    # Schedule a follow-up scan to catch files that arrived
                    # between the initial scan and observer startup
                    self._schedule_followup_scan()
            else:
                if self._observer is not None:
                    logger.info("Outbox directory disappeared, pausing watcher")
                    self._stop_observer()
                    was_missing = True

            self._stop_event.wait(timeout=self._poll_interval)

    def _schedule_followup_scan(self) -> None:
        """Scan again after a delay to catch files written during observer startup."""
        def _scan():
            self._stop_event.wait(timeout=3.0)
            if not self._stop_event.is_set():
                for path in self.scan_existing():
                    self._on_file_ready(path)
        t = threading.Thread(target=_scan, daemon=True)
        t.start()

    def _start_observer(self) -> None:
        """Create and start a fresh observer."""
        self._outbox_path.mkdir(parents=True, exist_ok=True)
        self._observer = PollingObserver(timeout=self._poll_interval)
        self._observer.schedule(self._handler, str(self._outbox_path), recursive=True)
        self._observer.daemon = True
        self._observer.start()
        logger.info("Watching %s (poll every %.1fs)", self._outbox_path, self._poll_interval)

    def _stop_observer(self) -> None:
        """Stop the current observer if running."""
        if self._observer is not None:
            try:
                self._observer.stop()
                self._observer.join(timeout=5)
            except Exception:
                pass
            self._observer = None
