/*\
title: $:/plugins/rimir/ext-connect/test/test-resolve.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for ext-connect resolution pipeline.

\*/
"use strict";

describe("ext-connect: resolve", function() {

	var resolve = require("$:/plugins/rimir/ext-connect/resolve.js");

	function setupWiki(tiddlers) {
		var wiki = new $tw.Wiki();
		wiki.addTiddlers(tiddlers || []);
		wiki.addIndexersToWiki();
		return wiki;
	}

	describe("buildVariables", function() {
		it("should include timestamp and profile", function() {
			var vars = resolve.buildVariables({profile: "test"}, []);
			expect(vars.profile).toBe("test");
			expect(vars.timestamp).toBeDefined();
			expect(vars.timestamp.length).toBe(17); // YYYYMMDDHHMMSSMMM
			expect(vars["context-titles"]).toBe("");
		});

		it("should map context tiddlers to indexed variables", function() {
			var ctx = [
				{title: "Foo", fields: {status: "open", priority: "high"}},
				{title: "Bar", fields: {status: "closed"}}
			];
			var vars = resolve.buildVariables({}, ctx);
			expect(vars["context.0.title"]).toBe("Foo");
			expect(vars["context.0.fields.status"]).toBe("open");
			expect(vars["context.0.fields.priority"]).toBe("high");
			expect(vars["context.1.title"]).toBe("Bar");
			expect(vars["context.1.fields.status"]).toBe("closed");
		});

		it("should stringify context-titles as TW list", function() {
			var ctx = [{title: "A", fields: {}}, {title: "B C", fields: {}}];
			var vars = resolve.buildVariables({}, ctx);
			expect(vars["context-titles"]).toContain("A");
			expect(vars["context-titles"]).toContain("B C");
		});

		it("should handle empty profile gracefully", function() {
			var vars = resolve.buildVariables({}, []);
			expect(vars.profile).toBe("");
		});

		it("should handle context tiddler with no fields object", function() {
			var ctx = [{title: "OnlyTitle"}];
			var vars = resolve.buildVariables({}, ctx);
			expect(vars["context.0.title"]).toBe("OnlyTitle");
		});
	});

	describe("loadContextTiddlers", function() {
		it("should load existing tiddlers from wiki", function() {
			var wiki = setupWiki([
				{title: "MyTiddler", text: "hello", tags: ["tagA", "tagB"], custom: "val"}
			]);
			var result = resolve.loadContextTiddlers(wiki, ["MyTiddler"]);
			expect(result.length).toBe(1);
			expect(result[0].title).toBe("MyTiddler");
			expect(result[0].tags).toEqual(["tagA", "tagB"]);
			expect(result[0].fields.custom).toBe("val");
		});

		it("should skip missing tiddlers", function() {
			var wiki = setupWiki([]);
			var result = resolve.loadContextTiddlers(wiki, ["NonExistent"]);
			expect(result.length).toBe(0);
		});

		it("should handle null/undefined input", function() {
			var wiki = setupWiki([]);
			expect(resolve.loadContextTiddlers(wiki, null)).toEqual([]);
			expect(resolve.loadContextTiddlers(wiki, undefined)).toEqual([]);
		});

		it("should load multiple tiddlers in order", function() {
			var wiki = setupWiki([
				{title: "First", text: "one"},
				{title: "Second", text: "two"},
				{title: "Third", text: "three"}
			]);
			var result = resolve.loadContextTiddlers(wiki, ["First", "Third"]);
			expect(result.length).toBe(2);
			expect(result[0].title).toBe("First");
			expect(result[1].title).toBe("Third");
		});

		it("should skip missing tiddlers but load the rest", function() {
			var wiki = setupWiki([
				{title: "Exists", text: "yes"}
			]);
			var result = resolve.loadContextTiddlers(wiki, ["Missing", "Exists", "AlsoMissing"]);
			expect(result.length).toBe(1);
			expect(result[0].title).toBe("Exists");
		});

		it("should handle empty array input", function() {
			var wiki = setupWiki([]);
			expect(resolve.loadContextTiddlers(wiki, [])).toEqual([]);
		});
	});

	describe("resolveFields", function() {
		it("should generate default title and type when not provided", function() {
			var wiki = setupWiki([]);
			var result = resolve.resolveFields({text: "hello"}, [], wiki);
			expect(result.fields.text).toBe("hello");
			expect(result.fields.title).toMatch(/^Inbox\//);
			expect(result.fields.type).toBe("text/vnd.tiddlywiki");
		});

		it("should use explicit title from body", function() {
			var wiki = setupWiki([]);
			var result = resolve.resolveFields({text: "hello", title: "MyTitle"}, [], wiki);
			expect(result.fields.title).toBe("MyTitle");
		});

		it("should apply body.fields as overrides", function() {
			var wiki = setupWiki([]);
			var result = resolve.resolveFields(
				{text: "hello", fields: {custom: "value", priority: "high"}},
				[], wiki
			);
			expect(result.fields.custom).toBe("value");
			expect(result.fields.priority).toBe("high");
		});

		it("should resolve profile template with out. prefix fields", function() {
			var wiki = setupWiki([
				{title: "$:/config/rimir/ext-connect/profiles", text: '{"myprofile": "MyTemplate"}', type: "application/json"},
				{title: "MyTemplate", "out.tags": "[[tag1]] [[tag2]]", "out.custom-field": "[[computed-value]]"}
			]);
			var result = resolve.resolveFields({text: "hello", profile: "myprofile"}, [], wiki);
			expect(result.fields.tags).toBe("tag1 tag2");
			expect(result.fields["custom-field"]).toBe("computed-value");
		});

		it("should evaluate first matching rule and stop", function() {
			var wiki = setupWiki([
				{title: "$:/config/rimir/ext-connect/rules", type: "application/json",
				 text: JSON.stringify([
					 {filter: "[[yes]]", templates: ["TplA"]},
					 {filter: "[[yes]]", templates: ["TplB"]}
				 ])},
				{title: "TplA", "out.source": "[[rule-a]]"},
				{title: "TplB", "out.source": "[[rule-b]]"}
			]);
			var result = resolve.resolveFields({text: "hello"}, [], wiki);
			expect(result.fields.source).toBe("rule-a");
		});

		it("should skip rules with no filter match", function() {
			var wiki = setupWiki([
				{title: "$:/config/rimir/ext-connect/rules", type: "application/json",
				 text: JSON.stringify([
					 {filter: "", templates: ["TplA"]},
					 {filter: "[[yes]]", templates: ["TplB"]}
				 ])},
				{title: "TplA", "out.source": "[[rule-a]]"},
				{title: "TplB", "out.source": "[[rule-b]]"}
			]);
			var result = resolve.resolveFields({text: "hello"}, [], wiki);
			expect(result.fields.source).toBe("rule-b");
		});

		it("should let body.text and body.title override template results", function() {
			var wiki = setupWiki([
				{title: "$:/config/rimir/ext-connect/profiles", text: '{"default": "TplDefault"}', type: "application/json"},
				{title: "TplDefault", "out.title": "[[Template Title]]"}
			]);
			var result = resolve.resolveFields({text: "body text", title: "Body Title", profile: "default"}, [], wiki);
			expect(result.fields.title).toBe("Body Title");
			expect(result.fields.text).toBe("body text");
		});

		it("should let body.fields override template fields", function() {
			var wiki = setupWiki([
				{title: "$:/config/rimir/ext-connect/profiles", text: '{"p1": "Tpl1"}', type: "application/json"},
				{title: "Tpl1", "out.priority": "[[low]]"}
			]);
			var result = resolve.resolveFields(
				{text: "hello", profile: "p1", fields: {priority: "critical"}},
				[], wiki
			);
			expect(result.fields.priority).toBe("critical");
		});

		it("should return empty actionText when no templates have actions", function() {
			var wiki = setupWiki([]);
			var result = resolve.resolveFields({text: "hello"}, [], wiki);
			expect(result.actionText).toBe("");
		});

		it("should collect actionText from template text fields", function() {
			var wiki = setupWiki([
				{title: "$:/config/rimir/ext-connect/profiles", text: '{"default": "TplAction"}', type: "application/json"},
				{title: "TplAction", text: "<$action-setfield $tiddler='test' value='done'/>", "out.source": "[[test]]"}
			]);
			var result = resolve.resolveFields({text: "hello", profile: "default"}, [], wiki);
			expect(result.actionText).toContain("action-setfield");
		});

		it("should apply multiple templates from a single rule", function() {
			var wiki = setupWiki([
				{title: "$:/config/rimir/ext-connect/rules", type: "application/json",
				 text: JSON.stringify([
					 {filter: "[[yes]]", templates: ["TplX", "TplY"]}
				 ])},
				{title: "TplX", "out.fieldx": "[[valx]]"},
				{title: "TplY", "out.fieldy": "[[valy]]"}
			]);
			var result = resolve.resolveFields({text: "hello"}, [], wiki);
			expect(result.fields.fieldx).toBe("valx");
			expect(result.fields.fieldy).toBe("valy");
		});

		it("should use 'default' profile when no profile specified", function() {
			var wiki = setupWiki([
				{title: "$:/config/rimir/ext-connect/profiles", text: '{"default": "TplDef"}', type: "application/json"},
				{title: "TplDef", "out.source": "[[default-source]]"}
			]);
			var result = resolve.resolveFields({text: "hello"}, [], wiki);
			expect(result.fields.source).toBe("default-source");
		});

		it("should handle missing profile gracefully", function() {
			var wiki = setupWiki([
				{title: "$:/config/rimir/ext-connect/profiles", text: '{}', type: "application/json"}
			]);
			var result = resolve.resolveFields({text: "hello", profile: "nonexistent"}, [], wiki);
			expect(result.fields.text).toBe("hello");
			expect(result.fields.title).toMatch(/^Inbox\//);
		});

		it("should handle missing profiles tiddler gracefully", function() {
			var wiki = setupWiki([]);
			var result = resolve.resolveFields({text: "hello"}, [], wiki);
			expect(result.fields.text).toBe("hello");
		});

		it("should not set type if template already set it", function() {
			var wiki = setupWiki([
				{title: "$:/config/rimir/ext-connect/profiles", text: '{"default": "TplType"}', type: "application/json"},
				{title: "TplType", "out.type": "[[text/plain]]"}
			]);
			var result = resolve.resolveFields({text: "hello", profile: "default"}, [], wiki);
			expect(result.fields.type).toBe("text/plain");
		});
	});
});
