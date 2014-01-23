// This module defines functions to apply an edit on a document representation
define(function(require, exports, module) {
"use strict";

var operations = require("./operations");
var Range = require("ace/range").Range;

/**
 * Apply an operation on a string document and return the resulting new document text.
 *
 * @param  {Opeartion} op - e.g. ["r2", "iabc", "r12"]
 * @param  {String} doc
 * @return {String} newDoc
 */
exports.applyContents = function(op, doc) {
    var i, len, newDoc = "";
    for (i = 0, len = op.length; i < len; i += 1) {
        switch (operations.type(op[i])) {
        case "retain":
            newDoc += doc.slice(0, operations.val(op[i]));
            doc = doc.slice(operations.val(op[i]));
            break;
        case "insert":
            newDoc += operations.val(op[i]);
            break;
        case "delete":
            if (doc.indexOf(operations.val(op[i])) !== 0)
                throw new TypeError("Expected '" + operations.val(op[i]) +
                    "' to delete, found '" + doc.slice(0, 10) + "'");
            doc = doc.slice(operations.val(op[i]).length);
            break;
        default:
            throw new TypeError("Unknown operation: " + operations.type(op[i]));
        }
    }
    return newDoc;
};

/**
 * Apply an operation on an Ace document
 *
 * @param  {Opeartion} op - e.g. ["r2", "iabc", "r12"]
 * @param  {String} doc
 */
exports.applyAce = function(op, editorDoc) {
    var i, len, index = 0, text = "";
    for (i = 0, len = op.length; i < len; i += 1) {
        switch (operations.type(op[i])) {
        case "retain":
            index += operations.val(op[i]);
            break;
        case "insert":
            text = operations.val(op[i]);
            editorDoc.insert(editorDoc.indexToPosition(index), text);
            index += text.length;
            break;
        case "delete":
            text = operations.val(op[i]);
            var startDel = editorDoc.indexToPosition(index);
            var endDel = editorDoc.indexToPosition(index + text.length);
            var range = Range.fromPoints(startDel, endDel);
            var docText = editorDoc.getTextRange(range);
            if (docText !== text)
                throw new TypeError("Expected '" + text +
                    "' to delete, found '" + docText + "'");
            editorDoc.remove(range);
            break;
        default:
            throw new TypeError("Unknown operation: " + operations.type(op[i]));
        }
    }
};

});
