/*\
title: $:/plugins/rimir/ext-connect/text-command
type: application/javascript
module-type: startup

Browser-side th-saving-tiddler hook: extracts @Target commands from tiddler text,
creates command tiddlers tagged for ext-outbox routing, and replaces commands with transclusions.
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
