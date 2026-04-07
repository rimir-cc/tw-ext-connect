/*\
title: $:/plugins/rimir/ext-connect/test/test-filesystem-paths-setup.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for ext-connect filesystem-paths-setup startup module.
Tests the rule detection and prepending logic by simulating what startup() does.

\*/
"use strict";

describe("ext-connect: filesystem-paths-setup", function() {

	var RULE = "[tag[ext-outbox]!has[draft.of]addprefix[ext-outbox/]]";
	var TIDDLER = "$:/config/FileSystemPaths";

	function setupWiki(tiddlers) {
		var wiki = new $tw.Wiki();
		wiki.addTiddlers(tiddlers || []);
		wiki.addIndexersToWiki();
		return wiki;
	}

	// Replicate the startup logic for testability
	function runSetup(wiki) {
		var existing = wiki.getTiddlerText(TIDDLER, "");
		if(existing.indexOf(RULE) !== -1) {
			return; // already present
		}
		var newText = existing ? RULE + "\n" + existing : RULE;
		wiki.addTiddler(new $tw.Tiddler(
			wiki.getTiddler(TIDDLER) || {title: TIDDLER},
			{text: newText}
		));
	}

	it("should add rule when FileSystemPaths tiddler does not exist", function() {
		var wiki = setupWiki([]);
		runSetup(wiki);
		var text = wiki.getTiddlerText(TIDDLER, "");
		expect(text).toBe(RULE);
	});

	it("should prepend rule when FileSystemPaths has existing rules", function() {
		var wiki = setupWiki([
			{title: TIDDLER, text: "[prefix[$:/]addprefix[system/]]"}
		]);
		runSetup(wiki);
		var text = wiki.getTiddlerText(TIDDLER, "");
		expect(text.indexOf(RULE)).toBe(0);
		expect(text).toContain("[prefix[$:/]addprefix[system/]]");
	});

	it("should not duplicate rule when already present", function() {
		var wiki = setupWiki([
			{title: TIDDLER, text: RULE + "\n[prefix[$:/]addprefix[system/]]"}
		]);
		runSetup(wiki);
		var text = wiki.getTiddlerText(TIDDLER, "");
		// Count occurrences of RULE
		var count = text.split(RULE).length - 1;
		expect(count).toBe(1);
	});

	it("should not duplicate when rule is embedded among other rules", function() {
		var wiki = setupWiki([
			{title: TIDDLER, text: "[prefix[$:/]]\n" + RULE + "\n[suffix[.json]]"}
		]);
		runSetup(wiki);
		var text = wiki.getTiddlerText(TIDDLER, "");
		var count = text.split(RULE).length - 1;
		expect(count).toBe(1);
	});

	it("should handle empty existing text", function() {
		var wiki = setupWiki([
			{title: TIDDLER, text: ""}
		]);
		runSetup(wiki);
		var text = wiki.getTiddlerText(TIDDLER, "");
		expect(text).toBe(RULE);
	});

	it("should preserve existing tiddler fields when prepending", function() {
		var wiki = setupWiki([
			{title: TIDDLER, text: "[some[filter]]", type: "text/vnd.tiddlywiki", custom: "preserved"}
		]);
		runSetup(wiki);
		var tiddler = wiki.getTiddler(TIDDLER);
		expect(tiddler.fields.custom).toBe("preserved");
		expect(tiddler.fields.text).toContain(RULE);
	});
});
