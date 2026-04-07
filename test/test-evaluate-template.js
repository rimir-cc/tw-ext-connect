/*\
title: $:/plugins/rimir/ext-connect/test/test-evaluate-template.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for ext-connect evaluateTemplate, evaluateFilter, readJsonTiddler, and executeActions.
These are internal functions tested via the resolve module's exported API and direct wiki manipulation.

\*/
"use strict";

describe("ext-connect: evaluateTemplate and helpers", function() {

	var resolve = require("$:/plugins/rimir/ext-connect/resolve.js");

	function setupWiki(tiddlers) {
		var wiki = new $tw.Wiki();
		wiki.addTiddlers(tiddlers || []);
		wiki.addIndexersToWiki();
		return wiki;
	}

	describe("template evaluation via resolveFields", function() {

		it("should evaluate out. prefix fields as filters", function() {
			var wiki = setupWiki([
				{title: "$:/config/rimir/ext-connect/profiles", text: '{"default": "Tpl"}', type: "application/json"},
				{title: "Tpl", "out.category": "[[work]]", "out.priority": "[[high]]"}
			]);
			var result = resolve.resolveFields({text: "hello", profile: "default"}, [], wiki);
			expect(result.fields.category).toBe("work");
			expect(result.fields.priority).toBe("high");
		});

		it("should stringify tags filter results as TW list", function() {
			var wiki = setupWiki([
				{title: "$:/config/rimir/ext-connect/profiles", text: '{"default": "Tpl"}', type: "application/json"},
				{title: "Tpl", "out.tags": "[[tag one]] [[tag two]] [[tag three]]"}
			]);
			var result = resolve.resolveFields({text: "hello", profile: "default"}, [], wiki);
			expect(result.fields.tags).toContain("tag one");
			expect(result.fields.tags).toContain("tag two");
			expect(result.fields.tags).toContain("tag three");
		});

		it("should skip out. fields with empty filter results", function() {
			var wiki = setupWiki([
				{title: "$:/config/rimir/ext-connect/profiles", text: '{"default": "Tpl"}', type: "application/json"},
				{title: "Tpl", "out.empty": "[prefix[nonexistent-xyz]]"}
			]);
			var result = resolve.resolveFields({text: "hello", profile: "default"}, [], wiki);
			expect(result.fields.empty).toBeUndefined();
		});

		it("should evaluate non-prefixed non-reserved fields as filters", function() {
			var wiki = setupWiki([
				{title: "$:/config/rimir/ext-connect/profiles", text: '{"default": "Tpl"}', type: "application/json"},
				{title: "Tpl", "mycustomfield": "[[computed-val]]"}
			]);
			var result = resolve.resolveFields({text: "hello", profile: "default"}, [], wiki);
			expect(result.fields.mycustomfield).toBe("computed-val");
		});

		it("should skip reserved fields from template (title, text, type, tags, created, modified, etc.)", function() {
			var wiki = setupWiki([
				{title: "$:/config/rimir/ext-connect/profiles", text: '{"default": "Tpl"}', type: "application/json"},
				{title: "Tpl", text: "action text here", type: "text/vnd.tiddlywiki"}
			]);
			// The template's own title/type/text should not bleed into output as fields
			// (text becomes actionText, title/type are reserved)
			var result = resolve.resolveFields({text: "hello", profile: "default"}, [], wiki);
			// text should be from body, not template
			expect(result.fields.text).toBe("hello");
		});

		it("should let out. prefix win over non-prefixed for same field name", function() {
			var wiki = setupWiki([
				{title: "$:/config/rimir/ext-connect/profiles", text: '{"default": "Tpl"}', type: "application/json"},
				{title: "Tpl", "out.status": "[[prefixed-val]]", "status": "[[non-prefixed-val]]"}
			]);
			var result = resolve.resolveFields({text: "hello", profile: "default"}, [], wiki);
			expect(result.fields.status).toBe("prefixed-val");
		});

		it("should handle non-string template field values by converting to string", function() {
			var wiki = setupWiki([
				{title: "$:/config/rimir/ext-connect/profiles", text: '{"default": "Tpl"}', type: "application/json"},
				{title: "Tpl"}
			]);
			// Manually add a tiddler with a numeric field value
			wiki.addTiddler(new $tw.Tiddler({title: "Tpl2", "out.num": 42}));
			wiki.addTiddler(new $tw.Tiddler(
				{title: "$:/config/rimir/ext-connect/profiles", text: '{"default": "Tpl2"}', type: "application/json"}
			));
			var result = resolve.resolveFields({text: "hello", profile: "default"}, [], wiki);
			// "42" as a filter returns "42"
			expect(result.fields.num).toBe("42");
		});

		it("should handle empty out. field name (out. with nothing after it)", function() {
			var wiki = setupWiki([
				{title: "$:/config/rimir/ext-connect/profiles", text: '{"default": "Tpl"}', type: "application/json"},
				{title: "Tpl", "out.": "[[should-be-skipped]]", "out.valid": "[[yes]]"}
			]);
			var result = resolve.resolveFields({text: "hello", profile: "default"}, [], wiki);
			expect(result.fields[""]).toBeUndefined();
			expect(result.fields.valid).toBe("yes");
		});

		it("should collect actionText from template text field", function() {
			var wiki = setupWiki([
				{title: "$:/config/rimir/ext-connect/profiles", text: '{"default": "Tpl"}', type: "application/json"},
				{title: "Tpl", text: "<$action-setfield $tiddler='test' value='done'/>"}
			]);
			var result = resolve.resolveFields({text: "hello", profile: "default"}, [], wiki);
			expect(result.actionText).toContain("action-setfield");
		});

		it("should not collect actionText when template text is whitespace-only", function() {
			var wiki = setupWiki([
				{title: "$:/config/rimir/ext-connect/profiles", text: '{"default": "Tpl"}', type: "application/json"},
				{title: "Tpl", text: "   \n  ", "out.field": "[[val]]"}
			]);
			var result = resolve.resolveFields({text: "hello", profile: "default"}, [], wiki);
			expect(result.actionText).toBe("");
		});

		it("should handle non-existent template tiddler gracefully", function() {
			var wiki = setupWiki([
				{title: "$:/config/rimir/ext-connect/profiles", text: '{"default": "NonExistent"}', type: "application/json"}
			]);
			var result = resolve.resolveFields({text: "hello", profile: "default"}, [], wiki);
			expect(result.fields.text).toBe("hello");
			expect(result.fields.title).toMatch(/^Inbox\//);
		});

		it("should concatenate actionText from profile and rule templates", function() {
			var wiki = setupWiki([
				{title: "$:/config/rimir/ext-connect/profiles", text: '{"default": "TplProfile"}', type: "application/json"},
				{title: "TplProfile", text: "<$action-log msg='profile'/>"},
				{title: "$:/config/rimir/ext-connect/rules", type: "application/json",
				 text: JSON.stringify([{filter: "[[yes]]", templates: ["TplRule"]}])},
				{title: "TplRule", text: "<$action-log msg='rule'/>"}
			]);
			var result = resolve.resolveFields({text: "hello", profile: "default"}, [], wiki);
			expect(result.actionText).toContain("profile");
			expect(result.actionText).toContain("rule");
		});
	});

	describe("readJsonTiddler (via resolveFields)", function() {

		it("should return fallback when profiles tiddler has invalid JSON", function() {
			var wiki = setupWiki([
				{title: "$:/config/rimir/ext-connect/profiles", text: "not json", type: "application/json"}
			]);
			// Should not crash, just skip profile lookup
			var result = resolve.resolveFields({text: "hello"}, [], wiki);
			expect(result.fields.text).toBe("hello");
		});

		it("should return fallback when rules tiddler has invalid JSON", function() {
			var wiki = setupWiki([
				{title: "$:/config/rimir/ext-connect/rules", text: "{broken", type: "application/json"}
			]);
			var result = resolve.resolveFields({text: "hello"}, [], wiki);
			expect(result.fields.text).toBe("hello");
		});
	});

	describe("evaluateFilter error handling (via resolveFields)", function() {

		it("should not throw on invalid filter syntax in template", function() {
			var wiki = setupWiki([
				{title: "$:/config/rimir/ext-connect/profiles", text: '{"default": "Tpl"}', type: "application/json"},
				{title: "Tpl", "out.field": "[invalid[filter[syntax"}
			]);
			// TW returns error message strings for broken filters (not exceptions).
			// evaluateFilter returns them as results. The field will have the error string.
			// Key assertion: it should not throw.
			expect(function() {
				resolve.resolveFields({text: "hello", profile: "default"}, [], wiki);
			}).not.toThrow();
		});

		it("should not throw on invalid filter syntax in rule filter", function() {
			var wiki = setupWiki([
				{title: "$:/config/rimir/ext-connect/rules", type: "application/json",
				 text: JSON.stringify([{filter: "[broken[filter", templates: ["Tpl"]}])},
				{title: "Tpl", "out.source": "[[val]]"}
			]);
			// Broken filters may return error strings (truthy), so the rule may match.
			// Key assertion: it should not throw.
			expect(function() {
				resolve.resolveFields({text: "hello"}, [], wiki);
			}).not.toThrow();
		});
	});

	describe("executeActions", function() {

		it("should execute action widgets that modify wiki state", function() {
			var wiki = setupWiki([]);
			var vars = {"new-title": "TestTiddler"};
			resolve.executeActions(wiki, "<$action-setfield $tiddler='ActionResult' text='executed'/>", vars);
			var t = wiki.getTiddler("ActionResult");
			expect(t).toBeDefined();
			expect(t.fields.text).toBe("executed");
		});

		it("should make variables available to action widgets", function() {
			var wiki = setupWiki([]);
			var vars = {"my-var": "hello-world"};
			resolve.executeActions(wiki, "<$action-setfield $tiddler='VarTest' text=<<my-var>>/>", vars);
			var t = wiki.getTiddler("VarTest");
			expect(t).toBeDefined();
			expect(t.fields.text).toBe("hello-world");
		});

		it("should do nothing when actionText is empty", function() {
			var wiki = setupWiki([]);
			// Should not throw
			resolve.executeActions(wiki, "", {});
			resolve.executeActions(wiki, "   ", {});
			resolve.executeActions(wiki, null, {});
		});
	});

	describe("loadContextTiddlers edge cases", function() {

		it("should handle non-array input gracefully", function() {
			var wiki = setupWiki([]);
			expect(resolve.loadContextTiddlers(wiki, "not-an-array")).toEqual([]);
			expect(resolve.loadContextTiddlers(wiki, 42)).toEqual([]);
			expect(resolve.loadContextTiddlers(wiki, {})).toEqual([]);
		});

		it("should convert non-string field values to strings", function() {
			var wiki = setupWiki([]);
			wiki.addTiddler(new $tw.Tiddler({title: "NumFields", numfield: 123}));
			var result = resolve.loadContextTiddlers(wiki, ["NumFields"]);
			expect(result[0].fields.numfield).toBe("123");
		});

		it("should handle null field values (dropped by TW Tiddler constructor)", function() {
			var wiki = setupWiki([]);
			wiki.addTiddler(new $tw.Tiddler({title: "NullField", somefield: null}));
			var result = resolve.loadContextTiddlers(wiki, ["NullField"]);
			// TW Tiddler constructor drops null fields entirely
			expect(result[0].fields.somefield).toBeUndefined();
		});

		it("should parse string tags via parseStringArray", function() {
			var wiki = setupWiki([]);
			wiki.addTiddler(new $tw.Tiddler({title: "StringTags", tags: "tagA tagB"}));
			var result = resolve.loadContextTiddlers(wiki, ["StringTags"]);
			expect(result[0].tags).toEqual(["tagA", "tagB"]);
		});
	});

	describe("makeFakeWidget (via variable resolution in templates)", function() {

		it("should make variables available to template filter evaluation", function() {
			var wiki = setupWiki([
				{title: "$:/config/rimir/ext-connect/profiles", text: '{"default": "Tpl"}', type: "application/json"},
				{title: "Tpl", "out.resolved": "[<profile>]"},
				{title: "ContextTiddler", text: "ctx content", custom: "ctx-val"}
			]);
			var ctx = [{title: "ContextTiddler", fields: {custom: "ctx-val"}}];
			var result = resolve.resolveFields({text: "hello", profile: "default"}, ctx, wiki);
			expect(result.fields.resolved).toBe("default");
		});

		it("should resolve context-indexed variables in templates", function() {
			var wiki = setupWiki([
				{title: "$:/config/rimir/ext-connect/profiles", text: '{"default": "Tpl"}', type: "application/json"},
				{title: "Tpl", "out.ctx-title": "[<context.0.title>]"}
			]);
			var ctx = [{title: "MyContext", fields: {}}];
			var result = resolve.resolveFields({text: "hello", profile: "default"}, ctx, wiki);
			expect(result.fields["ctx-title"]).toBe("MyContext");
		});
	});
});
