/*\
title: $:/plugins/rimir/ext-connect/test/test-route-http.js
type: application/javascript
tags: [[$:/tags/test-spec]]

HTTP-level tests for ext-connect's /api/ext-connect/put-tiddler route.

Requires the http-test-helper, only present in the tw-tests umbrella suite.
Per-plugin `npm test` skips this describe.

\*/

"use strict";

var helperAvailable = !!$tw.wiki.getTiddler("$:/test-helpers/http-server");

if(!helperAvailable) {
    describe("ext-connect: /api/ext-connect/put-tiddler (HTTP)", function() {
        it("requires the tw-tests umbrella suite (http-test-helper)", function() {
            pending("Run under tw-tests umbrella");
        });
    });
} else {

describe("ext-connect: /api/ext-connect/put-tiddler (HTTP)", function() {
    var http = require("$:/test-helpers/http-server");
    var ctx;

    beforeAll(function(done) {
        http.start({wiki: $tw.wiki}).then(function(c) { ctx = c; done(); });
    });
    afterAll(function(done) { ctx.stop().then(done); });

    function post(body, headers) {
        var h = {"X-Requested-With": "TiddlyWiki"};
        for(var k in (headers || {})) { h[k] = headers[k]; }
        return http.request(ctx, "/api/ext-connect/put-tiddler", {
            method: "POST",
            headers: h,
            body: body
        });
    }

    it("rejects requests missing the X-Requested-With CSRF header with 403", function(done) {
        // Same-origin pages can POST to the wiki port; the CSRF header is the
        // single check that distinguishes intentional TW calls from drive-by ones.
        // (TW 5.4's server now enforces this at the framework level too, so the
        // 403 may come from either layer — the rejection is what matters.)
        http.request(ctx, "/api/ext-connect/put-tiddler", {
            method: "POST",
            headers: {},  // intentionally NO X-Requested-With
            body: {text: "anything"}
        }).then(function(res) {
            expect(res.status).toBe(403);
            done();
        }).catch(done.fail);
    });

    it("rejects an invalid JSON body with 400", function(done) {
        http.request(ctx, "/api/ext-connect/put-tiddler", {
            method: "POST",
            headers: {"X-Requested-With": "TiddlyWiki", "Content-Type": "application/json"},
            body: "{not-json"
        }).then(function(res) {
            expect(res.status).toBe(400);
            expect((res.json() || {}).error).toMatch(/Invalid JSON/);
            done();
        }).catch(done.fail);
    });

    it("rejects a body missing the required `text` field with 400", function(done) {
        post({title: "no-body"}).then(function(res) {
            expect(res.status).toBe(400);
            expect((res.json() || {}).error).toMatch(/text/);
            done();
        }).catch(done.fail);
    });

    it("saves a tiddler when given a valid body and returns its title", function(done) {
        var title = "$:/temp/ext-connect-test/" + Date.now();
        post({title: title, text: "hello world"}).then(function(res) {
            expect(res.status).toBe(200);
            var body = res.json();
            expect(body.status).toBe("ok");
            expect(body.title).toBe(title);
            // Verify the tiddler actually landed in the wiki
            var t = $tw.wiki.getTiddler(title);
            expect(t).toBeTruthy();
            expect(t.fields.text).toBe("hello world");
            expect(t.fields.modified).toBeTruthy();
            done();
        }).catch(done.fail);
    });

    it("response has Content-Type application/json and open CORS", function(done) {
        post({text: "for-headers"}).then(function(res) {
            expect(res.headers["content-type"]).toMatch(/application\/json/);
            expect(res.headers["access-control-allow-origin"]).toBe("*");
            done();
        }).catch(done.fail);
    });
});

}
