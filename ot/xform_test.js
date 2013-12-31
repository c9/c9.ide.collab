"use strict";
"use server";

/*global require define module console*/
if (typeof process !== "undefined") {
    require("amd-loader");
    require("../../../test/setup_paths");
}

define(function(require, exports, module) {

var assert = require("ace/test/assertions");
var ops = require("./operations");
var xform = require("./xform");
var apply = require("./apply").applyContents;

function testXForm(original, a, b, expected) {
    var operationsA = ops.operation(original, a);
    var operationsB = ops.operation(original, b);
    xform(operationsA, operationsB, function (ap, bp) {
        console.log(original + " -< (" + a + ", " + b +") >- " + expected);
        console.log(original + " -< (" + operationsA + ", " + operationsB +") >- " + expected);
        console.log(original + " -< (" + ap + " - " + bp +") >- " + expected);

        var docA = apply(operationsA, original);
        var finalA = apply(bp, docA);
        console.log("  " + original + " -> " + docA + " -> " + finalA);
        assert.equal(finalA, expected,  finalA + " !== " + expected);

        var docB = apply(operationsB, original);
        var finalB = apply(ap, docB);
        console.log("  " + original + " -> " + docB + " -> " + finalB);
        assert.equal(finalB, expected, finalB + " !== " + expected);
    });
}

var xformTests = [
    ["at", "t", "fat", "ft"],
    ["nick", "Nick", "nick is cool", "Nick is cool"],
    ["sudo", "sumo", "suo", "sumo"],
    ["hello", "Hello", "Hello", "HHello"],
    ["care", "are", "are", "are"],
    ["air", "fair", "lair", "flair"],
    ["abc", "def", "abc", "def"]
];


xformTests.forEach(function(test) {
    exports["test xform '" + test[0] + "' --> '" + test[3] + "'"] = function(){
        testXForm.apply(null, test);
    };
});

});

if (typeof module !== "undefined" && module === require.main)
    require("asyncjs").test.testcase(module.exports).exec();
