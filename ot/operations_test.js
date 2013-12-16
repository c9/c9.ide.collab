/*global require define module console*/
"use strict";
"use server";

if (typeof process !== "undefined") {
    require("amd-loader");
    require("../../test/setup_paths");
}

define(function(require, exports, module) {

var assert = require("ace/test/assertions");
var operations = require("./operations");

module.exports = {

    "test operations operation constructs": function () {
        assert.equal(operations.insert("ab"), "iab");
        assert.equal(operations.del("ab"), "dab");
        assert.equal(operations.retain(3), "r3");
    },

    "test operations binary checks": function () {
        assert.equal(operations.isRetain("r2"), true);
        assert.equal(operations.isRetain("iab"), false);
        assert.equal(operations.isRetain("dab"), false);
        assert.equal(operations.isInsert("r2"), false);
        assert.equal(operations.isInsert("iab"), true);
        assert.equal(operations.isInsert("dab"), false);
        assert.equal(operations.isDelete("r2"), false);
        assert.equal(operations.isDelete("iab"), false);
        assert.equal(operations.isDelete("dab"), true);
    },

    "test operations.length": function () {
        assert.equal(operations.length("r15"), 15);
        assert.equal(operations.length("iabc"), 3);
        assert.equal(operations.length("dkfc"), 3);
    },

    "test operations.split": function () {
        assert.deepEqual(operations.split("r15", 5), ["r5", "r10"]);
        assert.deepEqual(operations.split("iabcd", 2), ["iab", "icd"]);
        assert.deepEqual(operations.split("dabcd", 2), ["dab", "dcd"]);
    },

    "test operations.pack": function () {
        assert.deepEqual(operations.pack(["r5", "r10"]), ["r15"]);
        assert.deepEqual(operations.pack(["iab", "icd"]), ["iabcd"]);
        assert.deepEqual(operations.pack(["dab", "dcd"]), ["dabcd"]);
        // multiple edits
        assert.deepEqual(operations.pack(["iab", "icd", "ief", "r1", "r2", "r3", "dks"]),
            ["iabcdef", "r6", "dks"]);
    },

    "test operations.unpack": function () {
        assert.deepEqual(operations.unpack(["r2"]), ["r1", "r1"]);
        assert.deepEqual(operations.unpack(["iab", "icd"]), ["ia", "ib", "ic", "id"]);
        assert.deepEqual(operations.unpack(["dab", "dcd"]), ["da", "db", "dc", "dd"]);
        // multiple edits
        assert.deepEqual(operations.unpack(["iab", "r3", "dks"]),
            ["ia", "ib", "r1", "r1", "r1", "dk", "ds"]);
    },

    "test operations.inverse": function () {
        assert.deepEqual(operations.inverse(["iab"]), ["dab"]);
        assert.deepEqual(operations.inverse(["dab"]), ["iab"]);
        assert.deepEqual(operations.inverse(["r3"]), ["r3"]);
        assert.deepEqual(operations.inverse(["iab", "icd", "r4", "dks", "dty"]), ["dab", "dcd", "r4", "iks", "ity"]);
    }
};

});

if (typeof module !== "undefined" && module === require.main)
    require("asyncjs").test.testcase(module.exports).exec();
