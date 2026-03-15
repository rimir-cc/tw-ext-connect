/*\
title: $:/plugins/rimir/ext-connect/text-command
type: application/javascript
module-type: startup

Browser-side th-saving-tiddler hook with two command modes:
1. Field-based: a @Target field (e.g. @Dodo) turns the whole tiddler into a command —
   tags it for ext-outbox, sets target/command-text/status/source, strips the trigger field.
2. Inline: extracts @Target text patterns, creates separate command tiddlers, replaces with transclusions.
\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

exports.name = "ext-connect-text-command";
exports.after = ["render"];
exports.platforms = ["browser"];
exports.synchronous = true;

exports.startup = function() {
	$tw.hooks.addHook("th-saving-tiddler", function(newTiddler) {
		if(!newTiddler) return newTiddler;
		// Read config
		var targetsText = $tw.wiki.getTiddlerText("$:/config/rimir/text-command/targets", "").trim();
		if(!targetsText) return newTiddler;

		var targets;
		try {
			targets = JSON.parse(targetsText);
		} catch(e) {
			return newTiddler;
		}
		if(!Array.isArray(targets) || targets.length === 0) return newTiddler;

		// --- Field-based command detection ---
		// A tiddler with a @Target field (e.g. @Dodo) becomes a command itself.
		// The field value is the instruction; the field is stripped after processing.
		var fieldOverrides = {};
		var fieldCommandTarget = null;
		var fieldNames = Object.keys(newTiddler.fields);
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
		if(fieldCommandTarget) {
			var outboxTagField = $tw.wiki.getTiddlerText("$:/config/rimir/text-command/outbox-tag", "ext-outbox").trim();
			var existingTags = newTiddler.fields.tags || [];
			if(!Array.isArray(existingTags)) {
				existingTags = $tw.utils.parseStringArray(existingTags) || [];
			}
			var tags = existingTags.slice();
			if(tags.indexOf(outboxTagField) === -1) {
				tags.push(outboxTagField);
			}
			fieldOverrides.tags = tags;
			fieldOverrides.target = fieldCommandTarget;
			fieldOverrides["command-text"] = newTiddler.fields["@" + fieldCommandTarget] || "";
			fieldOverrides.source = newTiddler.fields.title;
			if(!newTiddler.fields.status) {
				fieldOverrides.status = "pending";
			}
			// Strip the @Target trigger field
			var strippedFields = {};
			var allFields = Object.keys(newTiddler.fields);
			for(var si = 0; si < allFields.length; si++) {
				if(allFields[si] !== "@" + fieldCommandTarget) {
					strippedFields[allFields[si]] = newTiddler.fields[allFields[si]];
				}
			}
			newTiddler = new $tw.Tiddler(strippedFields, fieldOverrides);
		}

		// --- Inline text-command extraction ---
		var scanFilter = $tw.wiki.getTiddlerText("$:/config/rimir/text-command/scan-filter", "").trim();
		if(!scanFilter) return newTiddler;

		// Check if tiddler matches scan filter — temporarily add it so filter can inspect fields
		var title = newTiddler.fields.title;
		var previousTiddler = $tw.wiki.getTiddler(title);
		$tw.wiki.addTiddler(newTiddler);
		var matches;
		try {
			matches = $tw.wiki.filterTiddlers(scanFilter, null, $tw.wiki.makeTiddlerIterator([title]));
		} finally {
			// Restore previous state (the save will overwrite anyway, but be clean)
			if(previousTiddler) {
				$tw.wiki.addTiddler(previousTiddler);
			} else {
				$tw.wiki.deleteTiddler(title);
			}
		}
		if(matches.length === 0) return newTiddler;

		var text = newTiddler.fields.text;
		if(!text) return newTiddler;

		var outboxTag = $tw.wiki.getTiddlerText("$:/config/rimir/text-command/outbox-tag", "ext-outbox").trim();
		var viewTemplate = "$:/config/rimir/text-command/view-template";

		// Escape target names for regex
		var escapedTargets = targets.map(function(t) {
			return t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		});
		var targetGroup = escapedTargets.join("|");

		// Multi-line regex: ^@(Target)[ \t]*\n([\s\S]*?)^\1@[ \t]*$
		var multiLineRe = new RegExp("^@(" + targetGroup + ")[ \\t]*\\n([\\s\\S]*?)^\\1@[ \\t]*$", "gm");
		// Single-line regex: ^@(Target)[ \t]+(\S.*)$
		var singleLineRe = new RegExp("^@(" + targetGroup + ")[ \\t]+(\\S.*)$", "gm");

		var commandsCreated = [];
		var commandIndex = 0;

		// Process multi-line matches first
		text = text.replace(multiLineRe, function(match, target, commandText) {
			var timestamp = $tw.utils.stringifyDate(new Date()) + "" + (commandIndex++);
			var commandTitle = title + "/@" + target + "/" + timestamp;
			commandText = commandText.replace(/\n$/, ""); // trim trailing newline

			$tw.wiki.addTiddler(new $tw.Tiddler({
				title: commandTitle,
				tags: [outboxTag],
				text: commandText,
				source: title,
				target: target,
				"command-text": commandText,
				status: "pending",
				type: "text/vnd.tiddlywiki",
				created: $tw.utils.stringifyDate(new Date()),
				modified: $tw.utils.stringifyDate(new Date())
			}));
			commandsCreated.push(commandTitle);

			return "<$tiddler tiddler=\"" + commandTitle + "\"><$transclude $tiddler=\"" + viewTemplate + "\"/></$tiddler>";
		});

		// Process single-line matches
		text = text.replace(singleLineRe, function(match, target, commandText) {
			var timestamp = $tw.utils.stringifyDate(new Date()) + "" + (commandIndex++);
			var commandTitle = title + "/@" + target + "/" + timestamp;

			$tw.wiki.addTiddler(new $tw.Tiddler({
				title: commandTitle,
				tags: [outboxTag],
				text: commandText,
				source: title,
				target: target,
				"command-text": commandText,
				status: "pending",
				type: "text/vnd.tiddlywiki",
				created: $tw.utils.stringifyDate(new Date()),
				modified: $tw.utils.stringifyDate(new Date())
			}));
			commandsCreated.push(commandTitle);

			return "<$tiddler tiddler=\"" + commandTitle + "\"><$transclude $tiddler=\"" + viewTemplate + "\"/></$tiddler>";
		});

		if(commandsCreated.length === 0) return newTiddler;

		// Return modified tiddler with commands replaced by transclusions
		return new $tw.Tiddler(newTiddler, {text: text});
	});
};

})();
