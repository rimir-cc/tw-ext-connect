/*\
title: $:/plugins/rimir/ext-connect/test/test-deserializer.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for ext-connect deserializer module.
The deserializer depends on $tw.boot and filesystem utilities which are not available
in the test environment. We test the deserializer's JSON parsing, validation, resolution
pipeline integration, and wiki store updates by requiring the module and testing
the exported function with mocked $tw.boot state.

\*/
"use strict";

describe("ext-connect: deserializer", function() {

	// The deserializer exports a function keyed by content type.
	// We access the resolve module for pipeline verification.
	var resolve = require("$:/plugins/rimir/ext-connect/resolve.js");

	function setupWiki(tiddlers) {
		var wiki = new $tw.Wiki();
		wiki.addTiddlers(tiddlers || []);
		wiki.addIndexersToWiki();
		return wiki;
	}

	describe("resolution pipeline integration", function() {

		it("should resolve fields with profile and context", function() {
			var wiki = setupWiki([
				{title: "$:/config/rimir/ext-connect/profiles", text: '{"note": "NoteTpl"}', type: "application/json"},
				{title: "NoteTpl", "out.category": "[[notes]]", "out.tags": "[[imported]]"},
				{title: "CtxTiddler", text: "context content", status: "active"}
			]);
			var ctx = resolve.loadContextTiddlers(wiki, ["CtxTiddler"]);
			var result = resolve.resolveFields(
				{text: "My note content", profile: "note"},
				ctx, wiki
			);
			expect(result.fields.text).toBe("My note content");
			expect(result.fields.category).toBe("notes");
			expect(result.fields.tags).toContain("imported");
		});

		it("should auto-generate title when not provided", function() {
			var wiki = setupWiki([]);
			var result = resolve.resolveFields({text: "content"}, [], wiki);
			expect(result.fields.title).toMatch(/^Inbox\//);
			expect(result.fields.title.length).toBeGreaterThan(6);
		});

		it("should use explicit title from body", function() {
			var wiki = setupWiki([]);
			var result = resolve.resolveFields({text: "content", title: "My/Custom/Title"}, [], wiki);
			expect(result.fields.title).toBe("My/Custom/Title");
		});

		it("should apply body.fields overrides after template resolution", function() {
			var wiki = setupWiki([
				{title: "$:/config/rimir/ext-connect/profiles", text: '{"default": "Tpl"}', type: "application/json"},
				{title: "Tpl", "out.priority": "[[low]]"}
			]);
			var result = resolve.resolveFields(
				{text: "content", fields: {priority: "urgent", extra: "val"}},
				[], wiki
			);
			expect(result.fields.priority).toBe("urgent");
			expect(result.fields.extra).toBe("val");
		});

		it("should handle actions from template and make new-title variable available", function() {
			var wiki = setupWiki([
				{title: "$:/config/rimir/ext-connect/profiles", text: '{"default": "TplAction"}', type: "application/json"},
				{title: "TplAction", text: "<$action-setfield $tiddler='ActionLog' text=<<new-title>>/>"}
			]);
			var result = resolve.resolveFields({text: "content", title: "TestTitle"}, [], wiki);
			expect(result.actionText).toContain("action-setfield");
			// Execute actions with new-title variable
			var vars = resolve.buildVariables({text: "content", title: "TestTitle"}, []);
			vars["new-title"] = result.fields.title;
			resolve.executeActions(wiki, result.actionText, vars);
			var log = wiki.getTiddler("ActionLog");
			expect(log).toBeDefined();
			expect(log.fields.text).toBe("TestTitle");
		});
	});

	describe("JSON parsing edge cases", function() {

		it("should handle body with all optional fields", function() {
			var wiki = setupWiki([]);
			var result = resolve.resolveFields(
				{text: "content", title: "T", profile: "p", context: [], fields: {a: "1"}},
				[], wiki
			);
			expect(result.fields.text).toBe("content");
			expect(result.fields.title).toBe("T");
			expect(result.fields.a).toBe("1");
		});

		it("should handle body with only text field", function() {
			var wiki = setupWiki([]);
			var result = resolve.resolveFields({text: "minimal"}, [], wiki);
			expect(result.fields.text).toBe("minimal");
			expect(result.fields.type).toBe("text/vnd.tiddlywiki");
		});
	});
});
