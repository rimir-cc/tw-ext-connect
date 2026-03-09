/*\
title: $:/plugins/rimir/ext-connect/filesystem-paths-setup
type: application/javascript
module-type: startup

Server-side startup: ensures $:/config/FileSystemPaths contains the ext-outbox routing rule.
Prepends the rule if missing so it takes priority over broad catch-all filters.
\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

exports.name = "ext-connect-filesystem-paths-setup";
exports.after = ["load-modules"];
exports.before = ["commands"];
exports.platforms = ["node"];
exports.synchronous = true;

var RULE = "[tag[ext-outbox]!has[draft.of]addprefix[ext-outbox/]]";
var TIDDLER = "$:/config/FileSystemPaths";

exports.startup = function() {
	var existing = $tw.wiki.getTiddlerText(TIDDLER, "");
	if(existing.indexOf(RULE) !== -1) {
		return; // already present
	}
	var newText = existing ? RULE + "\n" + existing : RULE;
	$tw.wiki.addTiddler(new $tw.Tiddler(
		$tw.wiki.getTiddler(TIDDLER) || {title: TIDDLER},
		{text: newText}
	));
};

})();
