"""Subprocess wrapper for TiddlyWiki CLI operations (--render, --import)."""

from __future__ import annotations

import hashlib
import html
import json
import logging
import os
import re
import subprocess
import tempfile
from pathlib import Path

logger = logging.getLogger("tw_connector")


class TiddlyWikiCLI:
    """Wraps npx tiddlywiki subprocess calls for rendering context and importing replies."""

    def __init__(
        self,
        wiki_path: Path,
        npx_command: str = "npx",
        render_timeout: int = 30,
        import_timeout: int = 30,
    ) -> None:
        self.wiki_path = wiki_path
        self.npx_command = npx_command
        self.render_timeout = render_timeout
        self.import_timeout = import_timeout
        self.output_dir = wiki_path / "output"

    def _run(self, args: list[str], timeout: int) -> subprocess.CompletedProcess[str]:
        """Run a TiddlyWiki CLI command with TIDDLYWIKI_CLI_MODE=1."""
        env = os.environ.copy()
        env["TIDDLYWIKI_CLI_MODE"] = "1"
        env["TIDDLYWIKI_PLUGIN_PATH"] = str(self.wiki_path / "plugins")

        cmd = [self.npx_command, "tiddlywiki", str(self.wiki_path)] + args
        logger.debug("Running: %s", " ".join(cmd))

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            env=env,
            cwd=str(self.wiki_path.parent),
            shell=True,  # Required on Windows — npx is a .cmd file
        )

        logger.debug("stdout: %s", result.stdout.strip())
        if result.stderr.strip():
            logger.debug("stderr: %s", result.stderr.strip())

        return result

    def render_context(self, command_title: str) -> str:
        """Render context for a command tiddler using TW's cascade system.

        Runs: npx tiddlywiki <wiki> --render "[[title]]" "[[output.txt]]"
              "text/plain" "$:/config/rimir/text-command/delegate"

        Returns the rendered plain-text context.
        """
        # Unique output filename to avoid races between concurrent renders
        title_hash = hashlib.md5(command_title.encode()).hexdigest()[:12]
        output_name = f"_ext_ctx_{title_hash}.html"
        output_file = self.output_dir / output_name

        try:
            result = self._run(
                [
                    "--render",
                    f"[[{command_title}]]",
                    f"[[{output_name}]]",
                    "text/html",
                    "$:/config/rimir/text-command/delegate",
                ],
                self.render_timeout,
            )

            if result.returncode != 0:
                raise RuntimeError(
                    f"TW --render failed (exit {result.returncode}): {result.stderr}"
                )

            if not output_file.exists():
                raise RuntimeError(
                    f"Render output not found: {output_file}\nstdout: {result.stdout}"
                )

            raw_html = output_file.read_text(encoding="utf-8")
            context = self._html_to_text(raw_html)
            logger.debug("Rendered context (%d chars) for %s", len(context), command_title)
            return context

        finally:
            # Clean up output file
            if output_file.exists():
                output_file.unlink()

    @staticmethod
    def _html_to_text(raw: str) -> str:
        """Convert rendered HTML to plain text, preserving block structure."""
        # Insert newlines before block-level closing tags
        text = re.sub(r"<br\s*/?>", "\n", raw, flags=re.IGNORECASE)
        text = re.sub(r"</(?:p|div|h[1-6]|li|tr|blockquote)>", "\n", text, flags=re.IGNORECASE)
        text = re.sub(r"<(?:p|div|h[1-6]|blockquote)[^>]*>", "\n", text, flags=re.IGNORECASE)
        # Strip remaining HTML tags
        text = re.sub(r"<[^>]+>", "", text)
        # Decode HTML entities
        text = html.unescape(text)
        # Collapse runs of 3+ newlines into 2
        text = re.sub(r"\n{3,}", "\n\n", text)
        return text.strip()

    def import_reply(self, reply_json: dict) -> str:
        """Import a reply into the wiki via the ext-connect deserializer.

        Writes JSON to a temp file, runs:
            npx tiddlywiki <wiki> --import <tmp> application/x-rimir-ext-connect

        Returns the title of the created tiddler (parsed from stdout).
        """
        tmp_fd, tmp_path = tempfile.mkstemp(suffix=".json", prefix="tw_reply_")
        try:
            with os.fdopen(tmp_fd, "w", encoding="utf-8") as f:
                json.dump(reply_json, f)
            logger.debug("Import JSON: %s", json.dumps(reply_json, indent=2))

            result = self._run(
                ["--import", tmp_path, "application/x-rimir-ext-connect"],
                self.import_timeout,
            )

            if result.returncode != 0:
                raise RuntimeError(
                    f"TW --import failed (exit {result.returncode}): {result.stderr}"
                )

            # Parse title from stdout — deserializer logs "Saved: <title>"
            title = self._parse_import_title(result.stdout, reply_json)
            logger.debug("Imported reply as: %s", title)
            return title

        finally:
            Path(tmp_path).unlink(missing_ok=True)

    @staticmethod
    def _parse_import_title(stdout: str, reply_json: dict) -> str:
        """Extract the created tiddler title from import output."""
        # The deserializer logs: ext-connect: created "Inbox/20260309120000000" → /path/to/file.tid
        for line in stdout.splitlines():
            if 'ext-connect: created "' in line:
                start = line.index('created "') + len('created "')
                end = line.index('"', start)
                return line[start:end]

        # Fallback: if explicit title was given, use it
        if reply_json.get("title"):
            return reply_json["title"]

        # No title found — return a placeholder
        logger.warning("Could not parse import title from stdout: %s", stdout)
        return "(unknown)"
