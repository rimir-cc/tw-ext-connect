/*\
title: $:/plugins/rimir/ext-connect/route.js
type: application/javascript
module-type: route

POST /api/ext-connect/put-tiddler
Accepts JSON body with text (required), optional title, profile, context, fields.

\*/

"use strict";

var resolve = require("$:/plugins/rimir/ext-connect/resolve.js");

exports.method = "POST";
exports.path = /^\/api\/ext-connect\/put-tiddler$/;

exports.handler = function(request, response, state) {
	// CSRF check
	if(request.headers["x-requested-with"] !== "TiddlyWiki") {
		sendJson(response, 403, {error: "Missing X-Requested-With: TiddlyWiki header"});
		return;
	}
	// Parse JSON body (TW server reads body into state.data)
	var data;
	try {
		data = JSON.parse(state.data);
	} catch(e) {
		sendJson(response, 400, {error: "Invalid JSON body"});
		return;
	}
	if(!data.text) {
		sendJson(response, 400, {error: "Missing required field: text"});
		return;
	}
	try {
		processRequest(data, response);
	} catch(e) {
		sendJson(response, 500, {error: "Internal error: " + e.message});
	}
};

function processRequest(data, response) {
	// Load context tiddlers
	var contextTiddlers = resolve.loadContextTiddlers($tw.wiki, data.context);
	// Resolve fields via template tiddlers
	var result = resolve.resolveFields(data, contextTiddlers, $tw.wiki);
	var tiddlerFields = result.fields;
	var actionText = result.actionText;
	// Add created/modified timestamps
	var now = $tw.utils.stringifyDate(new Date());
	if(!tiddlerFields.created) {
		tiddlerFields.created = now;
	}
	tiddlerFields.modified = now;
	// Save main tiddler
	saveTiddler(tiddlerFields);
	// Execute post-creation actions if any
	if(actionText && actionText.trim()) {
		var vars = resolve.buildVariables(data, contextTiddlers);
		vars["new-title"] = tiddlerFields.title;
		resolve.executeActions($tw.wiki, actionText, vars);
		// Update syncer for any tiddlers modified by actions
		syncModifiedTiddlers();
	}
	sendJson(response, 200, {
		status: "ok",
		title: tiddlerFields.title
	});
}

/**
 * After action execution, find tiddlers with changed counts that the syncer
 * doesn't know about and mark them for file write.
 */
function syncModifiedTiddlers() {
	if(!$tw.syncer) {
		return;
	}
	var titles = $tw.wiki.allTitles();
	for(var i = 0; i < titles.length; i++) {
		var t = titles[i];
		var info = $tw.syncer.tiddlerInfo[t];
		var currentCount = $tw.wiki.getChangeCount(t);
		if(info && info.changeCount < currentCount) {
			// Syncer already tracks this tiddler but is behind — trigger write
			$tw.syncer.tiddlerInfo[t].changeCount = currentCount - 1;
		}
	}
}

function saveTiddler(fields) {
	$tw.wiki.addTiddler(new $tw.Tiddler(fields));
	// Update syncer info so syncer writes the file to disk
	if($tw.syncer) {
		$tw.syncer.tiddlerInfo[fields.title] = {
			changeCount: $tw.wiki.getChangeCount(fields.title) - 1,
			adaptorInfo: {},
			revision: null
		};
	}
}

function sendJson(response, statusCode, data) {
	var body = JSON.stringify(data);
	response.writeHead(statusCode, {
		"Content-Type": "application/json",
		"Access-Control-Allow-Origin": "*"
	});
	response.end(body);
}
