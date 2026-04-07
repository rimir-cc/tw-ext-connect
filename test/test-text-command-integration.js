/*\
title: $:/plugins/rimir/ext-connect/test/test-text-command-integration.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for ext-connect text-command integration logic:
config loading, scan-filter matching, tag handling, field stripping,
command tiddler creation, and transclusion replacement.

\*/
"use strict";

describe("ext-connect: text-command integration", function() {

	function setupWiki(tiddlers) {
		var wiki = new $tw.Wiki();
		wiki.addTiddlers(tiddlers || []);
		wiki.addIndexersToWiki();
		return wiki;
	}

	describe("config loading", function() {

		it("should parse targets JSON array", function() {
			var targetsText = '["Dodo", "Claude", "Assistant"]';
			var targets = JSON.parse(targetsText);
			expect(Array.isArray(targets)).toBe(true);
			expect(targets.length).toBe(3);
			expect(targets[0]).toBe("Dodo");
		});

		it("should handle invalid targets JSON gracefully", function() {
			var targetsText = "not json";
			var targets;
			try {
				targets = JSON.parse(targetsText);
			} catch(e) {
				targets = null;
			}
			expect(targets).toBeNull();
		});

		it("should handle empty targets array", function() {
			var targets = JSON.parse("[]");
			expect(Array.isArray(targets)).toBe(true);
			expect(targets.length).toBe(0);
		});

		it("should handle non-array JSON value", function() {
			var targets = JSON.parse('"just a string"');
			expect(Array.isArray(targets)).toBe(false);
		});
	});

	describe("field-based command detection", function() {

		it("should detect first matching @Target field", function() {
			var targets = ["Dodo", "Claude"];
			var fields = {title: "Test", text: "content", "@Claude": "do something", "@Dodo": "also this"};
			var fieldCommandTarget = null;
			var fieldNames = Object.keys(fields);
			for(var fi = 0; fi < fieldNames.length; fi++) {
				var fname = fieldNames[fi];
				if(fname.charAt(0) !== "@") continue;
				var candidateTarget = fname.substring(1);
				for(var ti = 0; ti < targets.length; ti++) {
					if(targets[ti] === candidateTarget) {
						fieldCommandTarget = candidateTarget;
						break;
					}
				}
				if(fieldCommandTarget) break;
			}
			// Should find one of the @Target fields (order depends on Object.keys)
			expect(fieldCommandTarget).toBeDefined();
			expect(["Dodo", "Claude"]).toContain(fieldCommandTarget);
		});

		it("should build field overrides for ext-outbox tagging", function() {
			var outboxTag = "ext-outbox";
			var existingTags = ["journal", "daily"];
			var tags = existingTags.slice();
			if(tags.indexOf(outboxTag) === -1) {
				tags.push(outboxTag);
			}
			expect(tags).toEqual(["journal", "daily", "ext-outbox"]);
		});

		it("should not duplicate ext-outbox tag if already present", function() {
			var outboxTag = "ext-outbox";
			var existingTags = ["ext-outbox", "journal"];
			var tags = existingTags.slice();
			if(tags.indexOf(outboxTag) === -1) {
				tags.push(outboxTag);
			}
			expect(tags).toEqual(["ext-outbox", "journal"]);
		});

		it("should strip @Target field from output", function() {
			var triggerField = "@Dodo";
			var allFields = {title: "Test", text: "content", "@Dodo": "instruction", custom: "val"};
			var strippedFields = {};
			var fieldNames = Object.keys(allFields);
			for(var i = 0; i < fieldNames.length; i++) {
				if(fieldNames[i] !== triggerField) {
					strippedFields[fieldNames[i]] = allFields[fieldNames[i]];
				}
			}
			expect(strippedFields["@Dodo"]).toBeUndefined();
			expect(strippedFields.title).toBe("Test");
			expect(strippedFields.text).toBe("content");
			expect(strippedFields.custom).toBe("val");
		});

		it("should set command-text from trigger field value", function() {
			var targetField = "@Dodo";
			var fields = {"@Dodo": "please handle this task"};
			var commandText = fields[targetField] || "";
			expect(commandText).toBe("please handle this task");
		});

		it("should set default status to pending when not already set", function() {
			var fields = {title: "Test"};
			var overrides = {};
			if(!fields.status) {
				overrides.status = "pending";
			}
			expect(overrides.status).toBe("pending");
		});

		it("should preserve existing status when already set", function() {
			var fields = {title: "Test", status: "in-progress"};
			var overrides = {};
			if(!fields.status) {
				overrides.status = "pending";
			}
			expect(overrides.status).toBeUndefined();
		});

		it("should handle string tags by parsing with parseStringArray", function() {
			var rawTags = "tag1 [[tag with space]]";
			var tags = $tw.utils.parseStringArray(rawTags) || [];
			expect(tags).toContain("tag1");
			expect(tags).toContain("tag with space");
		});
	});

	describe("scan-filter matching", function() {

		it("should match tiddler against scan filter using wiki.filterTiddlers", function() {
			var wiki = setupWiki([
				{title: "MyTiddler", text: "content", tags: ["journal"]}
			]);
			var matches = wiki.filterTiddlers("[tag[journal]]", null,
				wiki.makeTiddlerIterator(["MyTiddler"]));
			expect(matches.length).toBe(1);
			expect(matches[0]).toBe("MyTiddler");
		});

		it("should not match tiddler that fails scan filter", function() {
			var wiki = setupWiki([
				{title: "MyTiddler", text: "content", tags: ["note"]}
			]);
			var matches = wiki.filterTiddlers("[tag[journal]]", null,
				wiki.makeTiddlerIterator(["MyTiddler"]));
			expect(matches.length).toBe(0);
		});

		it("should handle complex scan filters", function() {
			var wiki = setupWiki([
				{title: "Draft of MyTiddler", text: "content", "draft.of": "MyTiddler"},
				{title: "RegularTiddler", text: "content"}
			]);
			// Filter that excludes drafts
			var matches = wiki.filterTiddlers("[!has[draft.of]]", null,
				wiki.makeTiddlerIterator(["Draft of MyTiddler"]));
			expect(matches.length).toBe(0);

			matches = wiki.filterTiddlers("[!has[draft.of]]", null,
				wiki.makeTiddlerIterator(["RegularTiddler"]));
			expect(matches.length).toBe(1);
		});
	});

	describe("command tiddler creation", function() {

		it("should create command tiddler with correct fields", function() {
			var wiki = setupWiki([]);
			var commandTitle = "Source/@Dodo/20260407120000000";
			wiki.addTiddler(new $tw.Tiddler({
				title: commandTitle,
				tags: ["ext-outbox"],
				text: "do something",
				source: "Source",
				target: "Dodo",
				"command-text": "do something",
				status: "pending",
				type: "text/vnd.tiddlywiki"
			}));
			var t = wiki.getTiddler(commandTitle);
			expect(t).toBeDefined();
			expect(t.fields.target).toBe("Dodo");
			expect(t.fields["command-text"]).toBe("do something");
			expect(t.fields.source).toBe("Source");
			expect(t.fields.status).toBe("pending");
		});

		it("should generate unique command titles with timestamp and index", function() {
			var title = "MyTiddler";
			var target = "Dodo";
			var timestamp = "202604071200000000";
			var titles = [];
			for(var i = 0; i < 3; i++) {
				titles.push(title + "/@" + target + "/" + timestamp + i);
			}
			// All titles should be unique
			var unique = titles.filter(function(t, idx) { return titles.indexOf(t) === idx; });
			expect(unique.length).toBe(3);
		});
	});

	describe("transclusion replacement", function() {

		it("should generate correct transclusion markup", function() {
			var commandTitle = "Source/@Dodo/20260407120000000";
			var viewTemplate = "$:/config/rimir/text-command/view-template";
			var transclusion = "<$tiddler tiddler=\"" + commandTitle + "\"><$transclude $tiddler=\"" + viewTemplate + "\"/></$tiddler>";
			expect(transclusion).toContain(commandTitle);
			expect(transclusion).toContain(viewTemplate);
			expect(transclusion).toContain("<$tiddler");
			expect(transclusion).toContain("<$transclude");
		});

		it("should replace multi-line blocks with transclusions in text", function() {
			var targets = ["Dodo"];
			var escapedTargets = targets.map(function(t) {
				return t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			});
			var targetGroup = escapedTargets.join("|");
			var multiLineRe = new RegExp("^@(" + targetGroup + ")[ \\t]*\\n([\\s\\S]*?)^\\1@[ \\t]*$", "gm");

			var text = "Before\n@Dodo\ndo this task\nDodo@\nAfter";
			var replaced = text.replace(multiLineRe, function(match, target, commandText) {
				return "[REPLACED:" + target + "]";
			});
			expect(replaced).toBe("Before\n[REPLACED:Dodo]\nAfter");
		});

		it("should replace single-line commands with transclusions in text", function() {
			var targets = ["Dodo"];
			var escapedTargets = targets.map(function(t) {
				return t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			});
			var targetGroup = escapedTargets.join("|");
			var singleLineRe = new RegExp("^@(" + targetGroup + ")[ \\t]+(\\S.*)$", "gm");

			var text = "Before\n@Dodo handle this\nAfter";
			var replaced = text.replace(singleLineRe, function(match, target, commandText) {
				return "[REPLACED:" + target + "]";
			});
			expect(replaced).toBe("Before\n[REPLACED:Dodo]\nAfter");
		});
	});
});
