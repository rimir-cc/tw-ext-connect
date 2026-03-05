/*\
title: $:/plugins/rimir/ext-connect/resolve.js
type: application/javascript
module-type: library

Shared resolution logic: profile lookup, template tiddler evaluation, action execution.
resolveFields(body, contextTiddlers, wiki) → {fields, actionText}

\*/

"use strict";

var PROFILES_TIDDLER = "$:/config/rimir/ext-connect/profiles";
var RULES_TIDDLER = "$:/config/rimir/ext-connect/rules";
var FIELD_PREFIX = "out.";

// Fields that belong to the template tiddler itself (not copied to output)
var RESERVED_FIELDS = {
	"title": true,
	"text": true,
	"type": true,
	"tags": true,
	"created": true,
	"modified": true,
	"creator": true,
	"modifier": true,
	"bag": true,
	"revision": true
};

/**
 * Generate a timestamp string: YYYYMMDDHHMMSSMMM
 */
function makeTimestamp() {
	var now = new Date();
	return now.getUTCFullYear().toString() +
		("0" + (now.getUTCMonth() + 1)).slice(-2) +
		("0" + now.getUTCDate()).slice(-2) +
		("0" + now.getUTCHours()).slice(-2) +
		("0" + now.getUTCMinutes()).slice(-2) +
		("0" + now.getUTCSeconds()).slice(-2) +
		("00" + now.getUTCMilliseconds()).slice(-3);
}

/**
 * Build the variables map from context tiddlers and request.
 */
function buildVariables(body, contextTiddlers) {
	var vars = {
		"timestamp": makeTimestamp(),
		"profile": body.profile || "",
		"context-titles": $tw.utils.stringifyList(
			contextTiddlers.map(function(ctx) { return ctx.title; })
		)
	};
	for(var i = 0; i < contextTiddlers.length; i++) {
		var ctx = contextTiddlers[i];
		vars["context." + i + ".title"] = ctx.title || "";
		var ctxFields = ctx.fields || {};
		var fieldNames = Object.keys(ctxFields);
		for(var f = 0; f < fieldNames.length; f++) {
			vars["context." + i + ".fields." + fieldNames[f]] = ctxFields[fieldNames[f]] || "";
		}
	}
	return vars;
}

/**
 * Create a fake widget that provides variables for TW filter evaluation.
 * Uses duck-typing: filter compiler only needs getVariable().
 */
function makeFakeWidget(vars) {
	return {
		getVariable: function(name) {
			return vars.hasOwnProperty(name) ? vars[name] : undefined;
		}
	};
}

/**
 * Evaluate a TW filter string, return array of results.
 */
function evaluateFilter(wiki, filterString, widget) {
	try {
		return wiki.filterTiddlers(filterString, widget);
	} catch(e) {
		return [];
	}
}

/**
 * Read and parse a JSON data tiddler. Returns parsed value or fallback.
 */
function readJsonTiddler(wiki, title, fallback) {
	var tiddler = wiki.getTiddler(title);
	if(!tiddler) {
		return fallback;
	}
	try {
		return JSON.parse(tiddler.fields.text);
	} catch(e) {
		return fallback;
	}
}

/**
 * Evaluate a template tiddler's fields into output fields.
 * Returns {outputFields: {...}, actionText: "..."}.
 *
 * Field convention:
 * - $:/fieldname → strip prefix → output field, value is TW filter
 * - non-prefixed, non-reserved → output field directly, value is TW filter
 * - reserved fields (title, text, type, tags, etc.) → skipped as output
 * - text field → collected as action widget markup
 * - $:/ version wins over non-prefixed if both exist
 */
function evaluateTemplate(wiki, templateTitle, widget) {
	var tiddler = wiki.getTiddler(templateTitle);
	if(!tiddler) {
		return {outputFields: {}, actionText: ""};
	}
	var outputFields = {};
	var actionText = tiddler.fields.text || "";
	var prefixedNames = {}; // track which output names came from $:/ fields

	var fieldNames = Object.keys(tiddler.fields);
	// First pass: process $:/ prefixed fields
	for(var i = 0; i < fieldNames.length; i++) {
		var name = fieldNames[i];
		if(name.indexOf(FIELD_PREFIX) === 0) {
			var outputName = name.substring(FIELD_PREFIX.length);
			if(!outputName) {
				continue;
			}
			var filterStr = tiddler.fields[name];
			if(typeof filterStr !== "string") {
				filterStr = String(filterStr);
			}
			var results = evaluateFilter(wiki, filterStr, widget);
			if(outputName === "tags") {
				outputFields.tags = $tw.utils.stringifyList(results);
			} else if(results.length > 0) {
				outputFields[outputName] = results[0];
			}
			prefixedNames[outputName] = true;
		}
	}
	// Second pass: process non-prefixed, non-reserved fields
	for(var j = 0; j < fieldNames.length; j++) {
		var fname = fieldNames[j];
		if(fname.indexOf(FIELD_PREFIX) === 0) {
			continue; // already handled
		}
		if(RESERVED_FIELDS[fname]) {
			continue; // skip reserved
		}
		if(prefixedNames[fname]) {
			continue; // $:/ version wins
		}
		var fval = tiddler.fields[fname];
		if(typeof fval !== "string") {
			fval = String(fval);
		}
		var fresults = evaluateFilter(wiki, fval, widget);
		if(fname === "tags") {
			outputFields.tags = $tw.utils.stringifyList(fresults);
		} else if(fresults.length > 0) {
			outputFields[fname] = fresults[0];
		}
	}

	return {outputFields: outputFields, actionText: actionText};
}

/**
 * Execute action widget markup server-side.
 * Creates a real Widget instance with $tw.fakeDocument and runs invokeActionString.
 */
function executeActions(wiki, actionText, vars) {
	if(!actionText || !actionText.trim()) {
		return;
	}
	var WidgetClass = require("$:/core/modules/widgets/widget.js").widget;
	var actionsWidget = new WidgetClass(null, {
		wiki: wiki,
		document: $tw.fakeDocument,
		parentWidget: $tw.rootWidget
	});
	var varNames = Object.keys(vars);
	for(var i = 0; i < varNames.length; i++) {
		actionsWidget.setVariable(varNames[i], vars[varNames[i]]);
	}
	actionsWidget.invokeActionString(actionText, actionsWidget, {});
}

/**
 * Main resolution function.
 * @param {Object} body - The request body (text, title, profile, context, fields)
 * @param {Array} contextTiddlers - Array of {title, fields, tags} objects
 * @param {Object} wiki - $tw.wiki reference
 * @returns {Object} {fields: {...}, actionText: "..."}
 */
function resolveFields(body, contextTiddlers, wiki) {
	var result = {};
	var allActionText = [];
	var vars = buildVariables(body, contextTiddlers);
	var widget = makeFakeWidget(vars);

	// 1. Profile lookup → template tiddler
	var profiles = readJsonTiddler(wiki, PROFILES_TIDDLER, {});
	var profileName = body.profile || "default";
	var profileTemplate = profiles[profileName];
	if(profileTemplate) {
		var profileResult = evaluateTemplate(wiki, profileTemplate, widget);
		var pKeys = Object.keys(profileResult.outputFields);
		for(var p = 0; p < pKeys.length; p++) {
			result[pKeys[p]] = profileResult.outputFields[pKeys[p]];
		}
		if(profileResult.actionText.trim()) {
			allActionText.push(profileResult.actionText);
		}
	}

	// 2. Rule evaluation (first match wins via TW filter)
	var rules = readJsonTiddler(wiki, RULES_TIDDLER, []);
	for(var i = 0; i < rules.length; i++) {
		var rule = rules[i];
		if(!rule.filter) {
			continue;
		}
		var filterResult = evaluateFilter(wiki, rule.filter, widget);
		if(filterResult.length > 0) {
			// Match! Evaluate all templates in order
			var templates = rule.templates || [];
			for(var t = 0; t < templates.length; t++) {
				var tplResult = evaluateTemplate(wiki, templates[t], widget);
				var tKeys = Object.keys(tplResult.outputFields);
				for(var k = 0; k < tKeys.length; k++) {
					result[tKeys[k]] = tplResult.outputFields[tKeys[k]];
				}
				if(tplResult.actionText.trim()) {
					allActionText.push(tplResult.actionText);
				}
			}
			break; // first match wins
		}
	}

	// 3. Explicit overrides from body.fields
	if(body.fields) {
		var explicitKeys = Object.keys(body.fields);
		for(var n = 0; n < explicitKeys.length; n++) {
			result[explicitKeys[n]] = body.fields[explicitKeys[n]];
		}
	}

	// 4. body.title and body.text override everything
	if(body.text) {
		result.text = body.text;
	}
	if(body.title) {
		result.title = body.title;
	}

	// 5. Title generation if still missing
	if(!result.title) {
		result.title = "Inbox/" + vars.timestamp;
	}

	// 6. Default type if not set
	if(!result.type) {
		result.type = "text/vnd.tiddlywiki";
	}

	return {fields: result, actionText: allActionText.join("\n")};
}

/**
 * Load context tiddlers from the wiki store.
 * @param {Object} wiki - $tw.wiki reference
 * @param {Array} contextArray - Array of tiddler titles
 * @returns {Array} Array of {title, fields, tags} objects
 */
function loadContextTiddlers(wiki, contextArray) {
	var contextTiddlers = [];
	if(!contextArray || !Array.isArray(contextArray)) {
		return contextTiddlers;
	}
	for(var i = 0; i < contextArray.length; i++) {
		var title = contextArray[i];
		var tiddler = wiki.getTiddler(title);
		if(tiddler) {
			var fields = {};
			var tags = [];
			var fieldNames = Object.keys(tiddler.fields);
			for(var f = 0; f < fieldNames.length; f++) {
				var key = fieldNames[f];
				if(key === "tags") {
					var rawTags = tiddler.fields.tags || [];
					tags = Array.isArray(rawTags) ? rawTags.slice() : $tw.utils.parseStringArray(rawTags) || [];
				} else {
					fields[key] = tiddler.fields[key] != null ? tiddler.fields[key].toString() : "";
				}
			}
			contextTiddlers.push({title: title, fields: fields, tags: tags});
		}
	}
	return contextTiddlers;
}

exports.resolveFields = resolveFields;
exports.buildVariables = buildVariables;
exports.executeActions = executeActions;
exports.loadContextTiddlers = loadContextTiddlers;
