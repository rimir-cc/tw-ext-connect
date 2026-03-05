# ext connect

> HTTP endpoint for external tools -- inbound (push tiddlers) and outbound (text-command extraction)

Push tiddlers into the wiki from external tools via CLI import -- no running server needed. A shared resolution pipeline with profile-based templates, context-aware rules, and post-creation actions transforms raw input into fully-formed tiddlers.

## Key features

* **CLI import** -- primary inbound path via `--import` deserializer, no server required
* **Context resolution** -- templates reference context tiddlers for smart field population and rule matching
* **Profile-based templates** -- map profiles to template tiddlers with filter-based field resolution
* **Rule-based dispatch** -- ordered rules use TW filters to match context and select templates
* **Post-creation actions** -- template `text` field runs action widgets server-side after tiddler creation
* **Text-command extraction** -- outbound processing of tiddler content for external tool integration

## Prerequisites

* Set `TIDDLYWIKI_CLI_MODE=1` environment variable for CLI import

## Quick start

Push a tiddler via CLI:

```bash
TIDDLYWIKI_CLI_MODE=1 npx tiddlywiki mywiki --import input.json application/x-rimir-ext-connect
```

Where `input.json` contains: `{"text": "Hello", "title": "MyTiddler"}`

**Fallback: POST API** (may be deprecated) -- if a server is running, you can also use `POST /api/ext-connect/put-tiddler` with `X-Requested-With: TiddlyWiki` header. See the reference docs for details.

## License

MIT -- see [LICENSE.md](LICENSE.md)
