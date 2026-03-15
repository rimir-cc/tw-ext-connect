/*\
title: $:/plugins/rimir/ext-connect/test/test-text-command.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for ext-connect text-command pattern matching and regex behavior.

\*/
"use strict";

describe("ext-connect: text-command patterns", function() {

	// The text-command module registers hooks at startup (browser-only),
	// so we test the regex patterns and replacement logic directly.
	// These regexes mirror what text-command.js builds from target names.

	function buildRegexes(targets) {
		var escapedTargets = targets.map(function(t) {
			return t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		});
		var targetGroup = escapedTargets.join("|");
		return {
			multiLine: new RegExp("^@(" + targetGroup + ")[ \\t]*\\n([\\s\\S]*?)^\\1@[ \\t]*$", "gm"),
			singleLine: new RegExp("^@(" + targetGroup + ")[ \\t]+(\\S.*)$", "gm")
		};
	}

	describe("single-line @Target pattern", function() {
		it("should match @Target followed by text on same line", function() {
			var re = buildRegexes(["MyTarget"]);
			var text = "Some text\n@MyTarget do something\nMore text";
			var match = re.singleLine.exec(text);
			expect(match).not.toBeNull();
			expect(match[1]).toBe("MyTarget");
			expect(match[2]).toBe("do something");
		});

		it("should match multiple single-line commands", function() {
			var re = buildRegexes(["Dodo", "Claude"]);
			var text = "@Dodo first task\nsome text\n@Claude second task";
			var matches = [];
			var match;
			while((match = re.singleLine.exec(text)) !== null) {
				matches.push({target: match[1], command: match[2]});
			}
			expect(matches.length).toBe(2);
			expect(matches[0].target).toBe("Dodo");
			expect(matches[0].command).toBe("first task");
			expect(matches[1].target).toBe("Claude");
			expect(matches[1].command).toBe("second task");
		});

		it("should not match @Target without trailing text", function() {
			var re = buildRegexes(["MyTarget"]);
			var text = "@MyTarget\nNext line";
			var match = re.singleLine.exec(text);
			expect(match).toBeNull();
		});

		it("should not match @Target with only whitespace after", function() {
			var re = buildRegexes(["MyTarget"]);
			var text = "@MyTarget   \nNext line";
			var match = re.singleLine.exec(text);
			expect(match).toBeNull();
		});

		it("should not match unknown targets", function() {
			var re = buildRegexes(["Dodo"]);
			var text = "@Claude do something";
			var match = re.singleLine.exec(text);
			expect(match).toBeNull();
		});

		it("should match target at beginning of text", function() {
			var re = buildRegexes(["Dodo"]);
			var text = "@Dodo handle this";
			var match = re.singleLine.exec(text);
			expect(match).not.toBeNull();
			expect(match[2]).toBe("handle this");
		});

		it("should capture full remaining line as command text", function() {
			var re = buildRegexes(["Dodo"]);
			var text = "@Dodo a long command with multiple words and @symbols";
			var match = re.singleLine.exec(text);
			expect(match[2]).toBe("a long command with multiple words and @symbols");
		});
	});

	describe("multi-line @Target block", function() {
		it("should match @Target...Target@ block", function() {
			var re = buildRegexes(["MyTarget"]);
			var text = "Before\n@MyTarget\nline one\nline two\nMyTarget@\nAfter";
			var match = re.multiLine.exec(text);
			expect(match).not.toBeNull();
			expect(match[1]).toBe("MyTarget");
			expect(match[2]).toBe("line one\nline two\n");
		});

		it("should not match when closing tag has wrong target name", function() {
			var re = buildRegexes(["MyTarget"]);
			var text = "@MyTarget\nsome text\nWrongTarget@";
			var match = re.multiLine.exec(text);
			expect(match).toBeNull();
		});

		it("should capture multi-line content including blank lines", function() {
			var re = buildRegexes(["Dodo"]);
			var text = "@Dodo\nfirst line\n\nsecond line\nDodo@";
			var match = re.multiLine.exec(text);
			expect(match).not.toBeNull();
			expect(match[2]).toBe("first line\n\nsecond line\n");
		});

		it("should match multiple blocks in same text", function() {
			var re = buildRegexes(["Dodo"]);
			var text = "@Dodo\nblock one\nDodo@\nsome text\n@Dodo\nblock two\nDodo@";
			var matches = [];
			var match;
			while((match = re.multiLine.exec(text)) !== null) {
				matches.push(match[2]);
			}
			expect(matches.length).toBe(2);
			expect(matches[0]).toBe("block one\n");
			expect(matches[1]).toBe("block two\n");
		});

		it("should handle targets with regex-special characters", function() {
			var re = buildRegexes(["My.Target"]);
			// Should NOT match "MyXTarget" — the dot must be literal
			var text = "@MyXTarget\ntext\nMyXTarget@";
			var match = re.multiLine.exec(text);
			expect(match).toBeNull();
		});

		it("should allow trailing whitespace on opening line", function() {
			var re = buildRegexes(["Dodo"]);
			var text = "@Dodo   \ncontent here\nDodo@";
			var match = re.multiLine.exec(text);
			expect(match).not.toBeNull();
			expect(match[2]).toBe("content here\n");
		});

		it("should allow trailing whitespace on closing line", function() {
			var re = buildRegexes(["Dodo"]);
			var text = "@Dodo\ncontent here\nDodo@   ";
			var match = re.multiLine.exec(text);
			expect(match).not.toBeNull();
		});
	});

	describe("replacement behavior", function() {
		it("multi-line blocks are replaced before single-line patterns", function() {
			// This tests the ordering: multi-line replacement happens first,
			// so a single-line @Target inside a block won't be double-matched
			var re = buildRegexes(["Dodo"]);
			var text = "@Dodo\n@Dodo inline inside block\nDodo@";
			var multiMatch = re.multiLine.exec(text);
			expect(multiMatch).not.toBeNull();
			// After multi-line replacement, the inner @Dodo line is consumed
			var replaced = text.replace(re.multiLine, "[BLOCK]");
			re.singleLine.lastIndex = 0;
			var singleMatch = re.singleLine.exec(replaced);
			expect(singleMatch).toBeNull();
		});
	});

	describe("field-based command detection", function() {
		// Test the field name matching logic:
		// A field named "@Target" (where Target is in the targets list) triggers field-based mode

		it("should identify @Target field names", function() {
			var targets = ["Dodo", "Claude"];
			var fieldNames = ["title", "text", "tags", "@Dodo", "custom"];
			var fieldCommandTarget = null;
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
			expect(fieldCommandTarget).toBe("Dodo");
		});

		it("should not match @-prefixed fields not in target list", function() {
			var targets = ["Dodo"];
			var fieldNames = ["@Unknown", "@Random"];
			var fieldCommandTarget = null;
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
			expect(fieldCommandTarget).toBeNull();
		});
	});
});
