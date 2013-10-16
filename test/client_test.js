/*global require define module global console*/
"use strict";

if (typeof process !== "undefined") {
    require("amd-loader");
    require("../../test/setup_paths");
}

define(function(require, exports, module) {

var assert = require("ace/test/assertions");
var EventEmitter = require("ace/lib/event_emitter").EventEmitter;
var ops = require("./operations");

global.DEBUG = 0;
var Client = require("./client_mocked");
var EditSession = require("ace/edit_session").EditSession;

function noop () {}

var preparedCs;
var packedCs;

function testHandleUserChanges(original, changes, expected) {
    preparedCs = ops.unpack(["r" + original.length]);
    packedCs = [];
    if (original.length)
        packedCs.push("r" + original.length);

    changes.forEach(function (change) {
        handleUserChanges1({data: change});
    });
    preparedCs = ops.pack(preparedCs);

    changes.forEach(function (change) {
        handleUserChanges2({data: change});
    });

    assert.deepEqual(expected, preparedCs, "expected != != preparedCs --> "  + expected + " != " + preparedCs);
    assert.deepEqual(expected, packedCs, "expected != != packedCs --> "  + expected + " != " + packedCs);
}

function handleUserChanges1(e) {
    var data = e.data;
    var startOff = data.offset;

    var realDocCs = 0, csOff = 0;
    while (realDocCs < startOff) {
        if (preparedCs[csOff][0] !== "d")
            realDocCs++;
        csOff++;
    }

    var newText;
    if (data.action === "insert") {
        newText = data.text;
        newText.split("").forEach(function(ch, i) {
            if (preparedCs[csOff+i] === ("d"+ch))
                preparedCs[csOff+i] = "r1";
            else
                preparedCs.splice(csOff+i, 0, "i" + ch);
        });
    }

    var i, tLen, t, ch;
    var removedText;
    if (data.action === "remove") {
        removedText = data.text;
        for (i = 0, tLen = removedText.length; i < tLen; i++) {
            ch = removedText[i];
            t = preparedCs[csOff + i][0];
            if (t === "r") {
                preparedCs[csOff + i] = "d" + ch;
            }
            else if (t === "i") {
                preparedCs.splice(csOff + i, 1);
                csOff--;
            }
            else if (t === "d") {
                csOff++;
                i--;
            }
        }
    }
    console.log("PreparedCS:", ops.pack(preparedCs));
}

function handleUserChanges2(e) {
    var data = e.data;
    var startOff = data.offset;

    var offset = startOff, opOff = 0;
    var op = packedCs[opOff];
    while (op) {
        if (ops.type(op) === "delete")
            ; // process next op
        else if (offset < ops.length(op))
            break;
        else
            offset -= ops.length(op);
        op = packedCs[++opOff];
    }

    if (offset !== 0) {
        var splitted = ops.split(op, offset);
        packedCs.splice(opOff, 1, splitted[0], splitted[1]);
        opOff++;
    }

    var newText;
    if (data.action === "insert") {
        newText = data.text;
        packedCs.splice(opOff, 0, "i" + newText);
    }

    var removedText;
    if (data.action === "remove") {
        removedText = data.text;
        var opIdx = opOff;
        var nextOp = packedCs[opIdx];
        while (removedText.length) {
            var opLen = ops.length(nextOp);
            var toRem = Math.min(removedText.length, opLen);
            switch(ops.type(nextOp)) {
            case "retain":
                packedCs[opIdx] = "d" + removedText.substring(0, toRem);
                if (opLen > removedText.length)
                    packedCs.splice(opIdx + 1, 0, "r" + (opLen - removedText.length));
                removedText = removedText.substring(toRem);
                opIdx++;
                break;
            case "insert":
                packedCs.splice(opIdx, 1);
                if (opLen > removedText.length)
                    packedCs.splice(opIdx, 0, ops.split(nextOp, toRem)[1]);
                removedText = removedText.substring(toRem);
                break;
            case "delete":
                opIdx++;
                break;
            }
            nextOp = packedCs[opIdx];
        }
    }

    console.log("PackedCS:", packedCs);
}

// Entry format
// original, array of actions, packed changeset
var handleChangesTests = [
    [
        "abc", [
            {action: "insert", offset: 1, text: "K"},
            {action: "remove", offset: 3, text: "c"}
        ], ["r1", "iK", "r1", "dc"]
    ],
    [
        "", [
            {action: "insert", offset: 0, text: "abc"},
            {action: "remove", offset: 1, text: "bc"}
        ], ["ia"]
    ],
    [
        "abc", [
            {action: "remove", offset: 0, text: "abc"}
        ], ["dabc"]
    ],
    [
        "abc", [
            {action: "insert", offset: 1, text: "K"},
            {action: "insert", offset: 3, text: "M"},
            {action: "remove", offset: 1, text: "Kb"}
        ], ["r1", "db", "iM", "r1"]
    ],
    [
        "abc", [
            {action: "remove", offset: 0, text: "ab"},
            {action: "insert", offset: 1, text: "de"}
        ], ["dab", "r1", "ide"]
    ],
    [
        "abc", [
            {action: "insert", offset: 1, text: "fg"},
            {action: "insert", offset: 1, text: "de"},
            {action: "remove", offset: 2, text: "ef"},
            {action: "remove", offset: 2, text: "gb"}
        ], ["r1", "id", "db", "r1"]
    ],
    [    "abc", [
            {action: "insert", offset: 1, text: "defg"},
            {action: "remove", offset: 0, text: "adef"}
        ], ["da", "ig", "r2"]
    ]
];

handleChangesTests.forEach(function(test) {
    exports["test handleUserChanges '" + test[0] + "' --> " + test[2].join(",")] = function(){
        testHandleUserChanges.apply(null, test);
    };
});

exports["test Client connect/disconnect"] = function (next) {

    var expectedNotif = ["CONNECTING", "CONNECT"];

    Client.on("notification", function (msg) {
        assert.equal(msg.type, expectedNotif[0]);
        expectedNotif.splice(0, 1);
    });

    Client.once("disconnect", function () {
        assert.equal(expectedNotif.length, 0);
        Client.removeAllListeners("notification");
        next();
    });

    Client.onConnect({
        connected: true,
        send: function (msg) {
            assert.equal(msg.type, "CONNECT");
            Client.onMessage({message: {
                command: "vfs-collab",
                type: "CONNECT",
                data: {}
            }});
            Client.onDisconnect();
        }
    });
};

exports["test Client joinDocument/leaveDocument"] = function (next) {

    var doc = {
        contents: "abc;\ndef;\n",
        revNum: 0,
        selections: {},
        revisions: [{revNum: 0, op: [], contents: "abc;\ndef;\n"}],
        authAttribs: []
    };

    Client.once("docloaded", function (ev) {
        var loadedDoc = ev.doc;
        assert(loadedDoc.isInited);
        assert.equal(loadedDoc, Client.getDoc("test.txt"));

        var otDocument = loadedDoc.ot;
        assert(otDocument.dispose); // check prototype function exists
        var otDataDoc = otDocument.otDoc;
        assert(otDataDoc); // more assertion that it's inited correctly
        assert.equal(doc.contents, otDataDoc.contents);
        assert.equal(doc.revNum, otDataDoc.revNum);
        assert.deepEqual(doc.revisions, otDataDoc.revisions);

        // Now let's leave the document
        Client.leaveDoc("test.txt");
        assert.equal(Client.isConnected("test.txt"), false);
        assert.ok(!Client.getDoc("test.txt"));
        assert.deepEqual(Client.getAllDocs(), {});
        Client.onDisconnect();
    });

    Client.once("disconnect", next.bind(null, null));

    Client.onConnect({
        connected: true,
        send: function (msg) {
            if (msg.type === "CONNECT")
                Client.onMessage({message: {
                    command: "vfs-collab",
                    type: "CONNECT",
                    data: {
                        myClientId: "id_1",
                        authorPool: {1: 1},
                        myUserId: 1
                    }
                }});

            if (msg.type !== "JOIN_DOC")
                return;

            // filesystem contents diffrent from the latest document state
            Client.getDoc("test.txt").ot.fsContents = "abc;\n";

            Client.onMessage({message: {
                command: "vfs-collab",
                type: "JOIN_DOC",
                data: {
                    docId: "test.txt",
                    clientId: "id_1",
                    chunkNum: 1,
                    chunksLength: 1,
                    chunk: JSON.stringify(doc)
                }
            }});
        }
    });

    // An edit was done before the document connects (loaded from filesystem)
    var session = new EditSession("abc;\nlol");
    var mockedC9Doc = {
        session: session,
        editor: {amlEditor: {"$editor": {
            getReadOnly: function() {return false;},
            // Called on disconnect
            setReadOnly: function (bool) {
                assert.equal(bool, true);
            }
        }
    }}};
    var mockState = {setState: noop, getState: noop};
    Client.joinDoc("test.txt", mockedC9Doc, session, mockState);
};

});

if (typeof module !== "undefined" && module === require.main)
    require("asyncjs").test.testcase(module.exports).exec();
