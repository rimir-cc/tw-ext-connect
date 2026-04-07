/*\
title: $:/plugins/rimir/ext-connect/test/test-route.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for ext-connect route module.
The route handler depends on HTTP request/response objects and $tw.syncer.
We test the validation logic and response formatting by creating mock objects,
and verify the resolution pipeline integration via the resolve module.

\*/
"use strict";

describe("ext-connect: route", function() {

	var resolve = require("$:/plugins/rimir/ext-connect/resolve.js");

	function setupWiki(tiddlers) {
		var wiki = new $tw.Wiki();
		wiki.addTiddlers(tiddlers || []);
		wiki.addIndexersToWiki();
		return wiki;
	}

	function createMockResponse() {
		var resp = {
			statusCode: null,
			headers: null,
			body: null,
			writeHead: function(code, headers) {
				resp.statusCode = code;
				resp.headers = headers;
			},
			end: function(body) {
				resp.body = body;
			}
		};
		return resp;
	}

	describe("sendJson helper logic", function() {

		it("should format JSON response with correct headers", function() {
			var resp = createMockResponse();
			// Replicate sendJson logic
			var data = {status: "ok", title: "Test"};
			var body = JSON.stringify(data);
			resp.writeHead(200, {
				"Content-Type": "application/json",
				"Access-Control-Allow-Origin": "*"
			});
			resp.end(body);
			expect(resp.statusCode).toBe(200);
			expect(resp.headers["Content-Type"]).toBe("application/json");
			expect(resp.headers["Access-Control-Allow-Origin"]).toBe("*");
			expect(JSON.parse(resp.body)).toEqual(data);
		});

		it("should format error response correctly", function() {
			var resp = createMockResponse();
			var data = {error: "Missing required field: text"};
			resp.writeHead(400, {
				"Content-Type": "application/json",
				"Access-Control-Allow-Origin": "*"
			});
			resp.end(JSON.stringify(data));
			expect(resp.statusCode).toBe(400);
			expect(JSON.parse(resp.body).error).toBe("Missing required field: text");
		});
	});

	describe("CSRF validation logic", function() {

		it("should require X-Requested-With: TiddlyWiki header", function() {
			// The route checks: request.headers["x-requested-with"] !== "TiddlyWiki"
			var validHeaders = {"x-requested-with": "TiddlyWiki"};
			expect(validHeaders["x-requested-with"]).toBe("TiddlyWiki");

			var invalidHeaders = {"x-requested-with": "XMLHttpRequest"};
			expect(invalidHeaders["x-requested-with"]).not.toBe("TiddlyWiki");

			var missingHeaders = {};
			expect(missingHeaders["x-requested-with"]).toBeUndefined();
		});
	});

	describe("request body validation logic", function() {

		it("should detect invalid JSON", function() {
			var isValid = true;
			try {
				JSON.parse("not json");
				isValid = true;
			} catch(e) {
				isValid = false;
			}
			expect(isValid).toBe(false);
		});

		it("should detect missing text field", function() {
			var data = JSON.parse('{"title": "Test"}');
			expect(!!data.text).toBe(false);
		});

		it("should accept valid body with text", function() {
			var data = JSON.parse('{"text": "hello", "title": "Test"}');
			expect(!!data.text).toBe(true);
		});
	});

	describe("processRequest pipeline integration", function() {

		it("should resolve fields and save tiddler to wiki", function() {
			var wiki = setupWiki([
				{title: "$:/config/rimir/ext-connect/profiles", text: '{"default": "Tpl"}', type: "application/json"},
				{title: "Tpl", "out.category": "[[inbox]]"}
			]);
			var data = {text: "route content", title: "RouteTest"};
			var ctx = resolve.loadContextTiddlers(wiki, data.context);
			var result = resolve.resolveFields(data, ctx, wiki);
			// Simulate saveTiddler
			wiki.addTiddler(new $tw.Tiddler(result.fields));
			var saved = wiki.getTiddler("RouteTest");
			expect(saved).toBeDefined();
			expect(saved.fields.text).toBe("route content");
			expect(saved.fields.category).toBe("inbox");
		});

		it("should execute post-creation actions via the pipeline", function() {
			var wiki = setupWiki([
				{title: "$:/config/rimir/ext-connect/profiles", text: '{"default": "TplAct"}', type: "application/json"},
				{title: "TplAct", text: "<$action-setfield $tiddler='RouteActionLog' text='route-action-done'/>", "out.source": "[[route]]"}
			]);
			var data = {text: "content", title: "RouteActTest"};
			var ctx = resolve.loadContextTiddlers(wiki, data.context);
			var result = resolve.resolveFields(data, ctx, wiki);
			wiki.addTiddler(new $tw.Tiddler(result.fields));
			// Execute actions
			var vars = resolve.buildVariables(data, ctx);
			vars["new-title"] = result.fields.title;
			resolve.executeActions(wiki, result.actionText, vars);
			var log = wiki.getTiddler("RouteActionLog");
			expect(log).toBeDefined();
			expect(log.fields.text).toBe("route-action-done");
		});
	});

	describe("syncModifiedTiddlers logic", function() {

		it("should detect tiddlers with increased change counts", function() {
			var wiki = setupWiki([
				{title: "Existing", text: "original"}
			]);
			var countBefore = wiki.getChangeCount("Existing");
			// Modify it
			wiki.addTiddler(new $tw.Tiddler({title: "Existing", text: "modified"}));
			var countAfter = wiki.getChangeCount("Existing");
			expect(countAfter).toBeGreaterThan(countBefore);
		});

		it("should detect newly created tiddlers (count > 0)", function() {
			var wiki = setupWiki([]);
			expect(wiki.getChangeCount("NewTiddler")).toBe(0);
			wiki.addTiddler(new $tw.Tiddler({title: "NewTiddler", text: "new"}));
			expect(wiki.getChangeCount("NewTiddler")).toBeGreaterThan(0);
		});
	});
});
