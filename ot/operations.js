// Operations are a stream of individual edits which span the whole document.
// Edits have a type which is one of retain, insert, or delete
// and have associated data based on their type.

/*global define */

define(function(require, exports, module) {
"use strict";

var DMP = require("ext/watcher/diff_match_patch_amd");
var diff_match_patch = DMP.diff_match_patch;
var DIFF_EQUAL = DMP.DIFF_EQUAL;
var DIFF_INSERT = DMP.DIFF_INSERT;
var DIFF_DELETE = DMP.DIFF_DELETE;

    function operation(s, t) {
        var dmp = new diff_match_patch();
        var diffs = dmp.diff_main(s, t);
        dmp.diff_cleanupSemantic(diffs);
        var d, type, val;
        var edits = [];
        for (var i = 0; i < diffs.length; i++) {
            d = diffs[i];
            type = d[0];
            val = d[1];
            switch(type) {
                case DIFF_EQUAL:
                    edits.push("r" + val.length);
                break;
                case DIFF_INSERT:
                    edits.push("i" + val);
                break;
                case DIFF_DELETE:
                    edits.push("d" + val);
                break;
            }
        }
        return edits;
    }

    // Simple edit constructors.

    function insert(chars) {
        return "i" + chars;
    }

    function del(chars) {
        return "d" + chars;
    }

    function retain(n) {
        return "r" + String(n);
    }

    function type(edit) {
        switch (edit.charAt(0)) {
        case "r":
            return "retain";
        case "d":
            return "delete";
        case "i":
            return "insert";
        default:
            throw new TypeError("Unknown type of edit: ", edit);
        }
    }

    function val(edit) {
        return type(edit) === "retain" ? ~~edit.slice(1) : edit.slice(1);
    }

    function length(edit) {
        return type(edit) === "retain" ? ~~edit.slice(1) : edit.length - 1;
    }

    function split(edit, num) {
        if (type(edit) === "retain") {
            var rCount = ~~edit.slice(1);
            return [
                "r" + num,
                "r" + (rCount - num)
            ];
        }
        else {
            return [
                edit[0] + edit.substring(1, num + 1),
                edit[0] + edit.substring(num + 1)
            ];
        }
    }

    function unpack(edits) {
        var edit, t, v, unpacked = [];
        var j;
        for (var i = 0, el = edits.length; i < el; i++) {
            edit = edits[i];
            t = type(edit);
            v = val(edit);
            if (t === "retain")
                while(v--)
                    unpacked.push("r1");
            else if (t === "insert")
                for (j = 0; j < v.length; j++)
                    unpacked.push("i" + v[j]);
            else if (t === "delete")
                for (j = 0; j < v.length; j++)
                    unpacked.push("d" + v[j]);
        }
        return unpacked;
    }

    function pack(edits) {
        var packed = edits.slice();
        var i = 0;
        while (i < packed.length - 1) {
            if (packed[i][0] === packed[i+1][0])
                packed.splice(i, 2, packed[i][0] + (val(packed[i]) + val(packed[i+1])));
            else
                i++;
        }
        return packed;
    }

    module.exports = {
        insert: insert,
        del: del,
        retain: retain,
        type: type,
        val: val,
        length: length,
        split: split,
        pack: pack,
        unpack: unpack,
        operation: operation,

        isDelete: function (edit) {
            return type(edit) === "delete";
        },

        isRetain: function (edit) {
            return type(edit) === "retain";
        },

        isInsert: function (edit) {
            return type(edit) === "insert";
        },

        inverse: function (edits) {
            var edit, t, v, inversed = new Array(edits.length);
            for (var i = 0, el = edits.length; i < el; i++) {
                edit = edits[i];
                t = type(edit);
                v = val(edit);
                switch (t) {
                    case "retain":
                        inversed[i] = edits[i];
                        break;
                    case "insert":
                        inversed[i] = del(v);
                        break;
                    case "delete":
                        inversed[i] = insert(v);
                        break;
                }
            }
            return inversed;
        }

    };

});
