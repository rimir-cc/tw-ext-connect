/*\
title: $:/plugins/rimir/ext-connect/deserializer.js
type: application/javascript
module-type: tiddlerdeserializer

CLI inbound path: --import input.json application/x-rimir-ext-connect
Parses the same JSON schema as the POST route, runs the shared resolution pipeline,
saves the tiddler to wiki store + disk, and executes post-creation actions.
Returns [] because we handle everything internally.

\*/

"use strict";

var resolve = require("$:/plugins/rimir/ext-connect/resolve.js");
var path = require("path");

/**
 * Resolve the tiddlers directory to write into.
 * When running from a CLI wrapper (includeWikis), use the first included wiki's
 * tiddlers path so files land in the real wiki, not the wrapper.
 */
function getTiddlersDirectory() {
	if(!$tw.boot.wikiTiddlersPath) {
		return null;
	}
	var wikiInfo = $tw.boot.wikiInfo || {};
	var includes = wikiInfo.includeWikis;
	if(includes && includes.length > 0) {
		var entry = includes[0];
		var includePath = typeof entry === "string" ? entry : entry.path;
		if(includePath) {
			var resolvedWiki = path.resolve($tw.boot.wikiPath, includePath);
			return path.resolve(resolvedWiki, "tiddlers");
		}
	}
	return $tw.boot.wikiTiddlersPath;
}

/**
 * Persist a tiddler to disk using FileSystemPaths config.
 * Returns the filepath or null if tiddlers directory is unavailable.
 */
function persistToDisk(fields) {
	var directory = getTiddlersDirectory();
	if(!directory) {
		return null;
	}
	var tiddler = new $tw.Tiddler(fields);
	var pathFilters = $tw.wiki.getTiddlerText("$:/config/FileSystemPaths", "")
		.split("\n").filter(function(f) { return f.trim(); });
	var fileInfo = $tw.utils.generateTiddlerFileInfo(tiddler, {
		directory: directory,
		pathFilters: pathFilters,
		wiki: $tw.wiki
	});
	$tw.utils.saveTiddlerToFileSync(tiddler, fileInfo);
	return fileInfo.filepath;
}

/**
 * After action execution, persist any tiddlers whose changeCount increased.
 */
function persistModifiedTiddlers(wiki, changeCountsBefore) {
	var titles = wiki.allTitles();
	for(var i = 0; i < titles.length; i++) {
		var title = titles[i];
		var currentCount = wiki.getChangeCount(title);
		var previousCount = changeCountsBefore[title] || 0;
		if(currentCount > previousCount) {
			var tiddler = wiki.getTiddler(title);
			if(tiddler) {
				persistToDisk(tiddler.fields);
			}
		}
	}
}

exports["application/x-rimir-ext-connect"] = function(text /*, fields, type */) {
	// 1. Parse JSON (same schema as POST body)
	var data;
	try {
		data = JSON.parse(text);
	} catch(e) {
		console.error("ext-connect deserializer: invalid JSON — " + e.message);
		return [];
	}
	if(!data.text) {
		console.error("ext-connect deserializer: missing required field 'text'");
		return [];
	}
	// 2. Load context tiddlers from wiki store
	var contextTiddlers = resolve.loadContextTiddlers($tw.wiki, data.context);
	// 3. Run resolution pipeline
	var result = resolve.resolveFields(data, contextTiddlers, $tw.wiki);
	var tiddlerFields = result.fields;
	var actionText = result.actionText;
	// 4. Add created/modified timestamps
	var now = $tw.utils.stringifyDate(new Date());
	if(!tiddlerFields.created) {
		tiddlerFields.created = now;
	}
	tiddlerFields.modified = now;
	// 5. Save to wiki store
	$tw.wiki.addTiddler(new $tw.Tiddler(tiddlerFields));
	// 6. Persist to disk
	var filepath = persistToDisk(tiddlerFields);
	// 7. Execute post-creation actions if any
	if(actionText && actionText.trim()) {
		// Snapshot changeCounts before actions
		var changeCountsBefore = {};
		var allTitles = $tw.wiki.allTitles();
		for(var i = 0; i < allTitles.length; i++) {
			changeCountsBefore[allTitles[i]] = $tw.wiki.getChangeCount(allTitles[i]);
		}
		var vars = resolve.buildVariables(data, contextTiddlers);
		vars["new-title"] = tiddlerFields.title;
		resolve.executeActions($tw.wiki, actionText, vars);
		// Persist any tiddlers modified by actions
		persistModifiedTiddlers($tw.wiki, changeCountsBefore);
	}
	// 8. Log success
	console.log("ext-connect: created \"" + tiddlerFields.title + "\"" +
		(filepath ? " → " + filepath : ""));
	// 9. Return empty — we handled everything
	return [];
};
