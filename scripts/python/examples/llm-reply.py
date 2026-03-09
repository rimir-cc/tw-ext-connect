"""LLM reply service — sends rendered context to an LLM and returns the response.

Supports Anthropic (Claude), OpenAI, and Azure OpenAI.

Setup (once):
    conda activate tw-connector
    pip install anthropic openai

Usage:
    # Anthropic (default)
    export ANTHROPIC_API_KEY="sk-ant-..."
    python llm-reply.py

    # OpenAI
    export OPENAI_API_KEY="sk-..."
    python llm-reply.py --provider openai

    # Azure OpenAI
    export AZURE_OPENAI_API_KEY="..."
    python llm-reply.py --provider azure \\
        --azure-endpoint https://myinstance.openai.azure.com \\
        --azure-deployment my-gpt4o-deployment

    # Override model / tokens
    python llm-reply.py --provider anthropic --model claude-sonnet-4-20250514 --max-tokens 2048

    # Verbose mode — prints full message payloads and LLM responses
    python llm-reply.py --verbose

Watches ext-outbox/ for @LLM commands, renders context via TW CLI,
sends command + context to the configured LLM, and writes the response
as an Inbox tiddler.

Press Ctrl+C to stop.
"""

import argparse
import json
import sys
import textwrap
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tw_connector import Command, Connector, ConnectorConfig, Reply

WIKI_PATH = Path(__file__).resolve().parent.parent.parent.parent.parent.parent.parent
# ↑ examples -> python -> scripts -> ext-connect -> rimir -> plugins -> dev-wiki

DEFAULTS = {
    "anthropic": {"model": "claude-sonnet-4-20250514", "max_tokens": 4096},
    "openai":    {"model": "gpt-4o",                   "max_tokens": 4096},
    "azure":     {"model": None,                        "max_tokens": 4096},  # uses deployment name
}

SYSTEM_PROMPT = """\
You are a helpful assistant embedded in a TiddlyWiki knowledge base.
The user sends you a question or instruction along with rendered context \
from their wiki. Answer concisely using TiddlyWiki wikitext markup where \
appropriate (e.g. bold, lists, links). Do not wrap your entire response \
in a code block.\
"""

EPILOG = """\
environment variables:
  ANTHROPIC_API_KEY       API key for Anthropic (--provider anthropic)
  OPENAI_API_KEY          API key for OpenAI (--provider openai)
  AZURE_OPENAI_API_KEY    API key for Azure OpenAI (--provider azure)

examples:
  %(prog)s
      Start with Anthropic Claude (default). Reads ANTHROPIC_API_KEY.

  %(prog)s --provider openai --model gpt-4o-mini
      Use OpenAI with a specific model.

  %(prog)s --provider azure --azure-endpoint https://my.openai.azure.com \\
           --azure-deployment gpt4o
      Use an Azure OpenAI deployment.

  %(prog)s --verbose
      Print the full messages sent to the LLM and the complete response text.

  %(prog)s --log-level DEBUG
      Enable debug logging for the tw_connector library (file watcher, CLI calls).

workflow:
  1. The script watches dev-wiki/tiddlers/ext-outbox/ for .tid files
  2. When a file with status: pending and target: LLM appears, it picks it up
  3. Context tiddlers referenced by the command are rendered via TW CLI
  4. The command text + rendered context are sent to the configured LLM
  5. The LLM response is written back as an Inbox/<timestamp> tiddler

  Commands are created in the wiki by the ext-connect text-command UI.
  The target field must be "LLM" (case-sensitive).
"""


# --- Provider-specific client + handler factories ---

def _create_anthropic_handler(model: str, max_tokens: int, verbose: bool):
    import anthropic

    client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY

    def handle(command: Command) -> Reply:
        messages = []
        if command.context:
            messages.append({"role": "user", "content": f"Here is context from my wiki:\n\n{command.context}"})
            messages.append({"role": "assistant", "content": "Thanks, I've read the context. What would you like me to do with it?"})
        messages.append({"role": "user", "content": command.command_text})

        if verbose:
            _print_messages(messages, system=SYSTEM_PROMPT)

        print(f"  Calling {model}...")
        response = client.messages.create(
            model=model,
            max_tokens=max_tokens,
            system=SYSTEM_PROMPT,
            messages=messages,
        )
        reply_text = response.content[0].text
        print(f"  Response: {len(reply_text)} chars, {response.usage.output_tokens} tokens")

        if verbose:
            _print_response(reply_text)

        return Reply(text=reply_text, context=[command.source] if command.source else None)

    return handle


def _create_openai_handler(model: str, max_tokens: int, verbose: bool, *, azure_endpoint: str | None = None, azure_deployment: str | None = None):
    from openai import AzureOpenAI, OpenAI

    if azure_endpoint:
        client = AzureOpenAI(
            azure_endpoint=azure_endpoint,
            azure_deployment=azure_deployment,
            api_version="2024-12-01-preview",
        )
        display_model = azure_deployment
    else:
        client = OpenAI()  # reads OPENAI_API_KEY
        display_model = model

    def handle(command: Command) -> Reply:
        messages = [{"role": "system", "content": SYSTEM_PROMPT}]
        if command.context:
            messages.append({"role": "user", "content": f"Here is context from my wiki:\n\n{command.context}"})
            messages.append({"role": "assistant", "content": "Thanks, I've read the context. What would you like me to do with it?"})
        messages.append({"role": "user", "content": command.command_text})

        if verbose:
            _print_messages(messages)

        print(f"  Calling {display_model}...")
        response = client.chat.completions.create(
            model=model or azure_deployment,
            max_tokens=max_tokens,
            messages=messages,
        )
        reply_text = response.choices[0].message.content
        print(f"  Response: {len(reply_text)} chars, {response.usage.completion_tokens} tokens")

        if verbose:
            _print_response(reply_text)

        return Reply(text=reply_text, context=[command.source] if command.source else None)

    return handle


# --- Verbose output helpers ---

def _print_messages(messages: list[dict], *, system: str | None = None):
    """Print the full message payload sent to the LLM."""
    print("  ┌─── Messages sent to LLM ───")
    if system:
        print(f"  │ [system] {system}")
    for msg in messages:
        role = msg["role"]
        content = msg["content"]
        lines = content.splitlines()
        print(f"  │ [{role}] {lines[0]}")
        for line in lines[1:]:
            print(f"  │   {line}")
    print("  └──────────────────────────────")


def _print_response(text: str):
    """Print the full LLM response text."""
    print("  ┌─── LLM response ───")
    for line in text.splitlines():
        print(f"  │ {line}")
    print("  └─────────────────────")


# --- Wiring ---

def _build_handler(args):
    """Build the LLM handler based on CLI args."""
    provider = args.provider
    defaults = DEFAULTS[provider]
    model = args.model or defaults["model"]
    max_tokens = args.max_tokens or defaults["max_tokens"]
    verbose = args.verbose

    if provider == "anthropic":
        handler = _create_anthropic_handler(model, max_tokens, verbose)
    elif provider == "openai":
        handler = _create_openai_handler(model, max_tokens, verbose)
    elif provider == "azure":
        if not args.azure_endpoint:
            sys.exit("Error: --azure-endpoint is required for azure provider")
        if not args.azure_deployment:
            sys.exit("Error: --azure-deployment is required for azure provider")
        handler = _create_openai_handler(model, max_tokens, verbose, azure_endpoint=args.azure_endpoint, azure_deployment=args.azure_deployment)

    display_model = args.azure_deployment if provider == "azure" else model
    return handler, display_model, max_tokens


def _wrap_handler(handler):
    """Add common logging around a provider handler."""
    def wrapped(command: Command) -> Reply:
        print(f"  Command: {command.command_text}")
        print(f"  Source:  {command.source}")
        print(f"  Context: {len(command.context or '')} chars")
        return handler(command)
    return wrapped


def main():
    parser = argparse.ArgumentParser(
        prog="llm-reply.py",
        description="LLM reply service for TiddlyWiki ext-connect — watches ext-outbox/ "
                    "for @LLM commands and sends them to a configurable LLM provider.",
        epilog=EPILOG,
        formatter_class=argparse.RawDescriptionHelpFormatter,
        add_help=False,
    )

    general = parser.add_argument_group("general")
    general.add_argument("-h", "--help", "-?", action="help", default=argparse.SUPPRESS,
                         help="Show this help message and exit.")
    general.add_argument("-v", "--verbose", action="store_true",
                         help="Print full message payloads and LLM responses to console.")
    general.add_argument("--log-level", default="INFO", choices=["DEBUG", "INFO", "WARNING", "ERROR"],
                         help="Log level for tw_connector internals (default: INFO).")

    provider_group = parser.add_argument_group("provider")
    provider_group.add_argument("--provider", default="anthropic", choices=["anthropic", "openai", "azure"],
                                help="LLM provider (default: anthropic).")
    provider_group.add_argument("--model", default=None,
                                help="Model name. Defaults: anthropic=claude-sonnet-4-20250514, openai=gpt-4o.")
    provider_group.add_argument("--max-tokens", type=int, default=None,
                                help="Max output tokens (default: 4096).")

    azure_group = parser.add_argument_group("azure openai")
    azure_group.add_argument("--azure-endpoint", default=None,
                             help="Azure OpenAI endpoint URL (required for --provider azure).")
    azure_group.add_argument("--azure-deployment", default=None,
                             help="Azure OpenAI deployment name (required for --provider azure).")

    args = parser.parse_args()

    handler, display_model, max_tokens = _build_handler(args)
    handler = _wrap_handler(handler)

    config = ConnectorConfig(wiki_path=WIKI_PATH, log_level=args.log_level)

    print(f"Wiki path:  {config.wiki_path}")
    print(f"Outbox:     {config.outbox_path}")
    print(f"Provider:   {args.provider}")
    print(f"Model:      {display_model}")
    print(f"Max tokens: {max_tokens}")
    if args.verbose:
        print(f"Verbose:    on")
    print()

    conn = Connector(config)
    conn.on("LLM", handler)
    conn.start()


if __name__ == "__main__":
    main()
