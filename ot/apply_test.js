"use strict";
"use server";


require("c9/inline-mocha")(module);
if (typeof process !== "undefined") {
    require("amd-loader");
    require("../../../test/setup_paths");
}

var Document = require("ace/document").Document;
var assert = require("ace/test/assertions");
var applyTestTransformations = require("./apply_test_transformations");

var operations = require("./operations");
var applyContents = require("./apply").applyContents;
var applyAce = require("./apply").applyAce;

function test(str, result) {
    var op = operations.operation(str, result);
    console.log("OP:", op);
    var resultContents = applyContents(op, str);
    assert.equal(resultContents, result, "applyContents failed");
    var doc = new Document(str);
    applyAce(op, doc);
    var resultAce = doc.getValue();
    assert.equal(resultAce, result, "applyContents failed");
}

describe(__filename, function() {
    // it("should test different apply cases", function() {
    //     test("abc", "abcd");
    //     test("abc", "abdef");
    //     test("abc-def", "c-efiy");
    //     test("abc-def", "");
    //     test("", "fly");
    //     test("abc\ndef\njhi", "def\nabc\njhi");
    // });
    
    it("Should be able to apply these transformations", function() {
        var doc = "";
        var transformations = applyTestTransformations.map(function(x) {
            return x.operation;
        })
        // .filter(function(a) {
        //     return a.length;
        // });
        // for (var i = 0; i < transformations.length; i++) {
        //     doc = applyContents(transformations[i], doc);
        // }
        
        var rev0Contents = ""
        for (var i = 1; i < transformations.length; i++) {
            require("fs").writeFileSync(__dirname+"/data/"+i, rev0Contents, "utf8")
            var forwardOp = transformations[i]
            // var op = operations.inverse(forwardOp);
            // var c = rev0Contents
            console.log("\n>>", i, forwardOp, "<<")
            // console.log(i, op)
            rev0Contents = applyContents(forwardOp, rev0Contents);
            console.log(i, rev0Contents)
            // if (applyContents(forwardOp, rev0Contents) != c)
            //     throw 1;
            // console.log(op, forwardOp)
        }
        if (rev0Contents != revCache.contents)
            throw "value mismatch"
        return
        
        console.log("Final doc: ", doc);
        var revCache = applyTestTransformations.revCache;
        var rev0Contents = revCache.contents;
        for (var i = revCache.revNum; i > 0; i--) {
            require("fs").writeFileSync(__dirname+"/data/"+i, rev0Contents, "utf8")
            var forwardOp = transformations[i]
            var op = operations.inverse(forwardOp);
            var c = rev0Contents
            console.log(i, forwardOp)
            console.log(i, op)
            rev0Contents = applyContents(op, rev0Contents);
            if (applyContents(forwardOp, rev0Contents) != c)
                throw 1;
            // console.log(op, forwardOp)
        }
        
    });
});
