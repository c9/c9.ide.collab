/*global require define module global __dirname console setTimeout process*/
"use strict";

var assert = require("assert");
var async = require("async");
var vfsLocal = require("vfs-local");
var fsnode = require("vfs-nodefs-adapter");

var fs = require("fs");
var vfsCollab = require("./vfs.collab");
var execFile = require("child_process").execFile;
var path = require("path");

require("amd-loader");
require("../../test/setup_paths");

var noop = function(){};

var oop = require("ace/lib/oop");
var lang = require("ace/lib/lang");
var EventEmitter = require("ace/lib/event_emitter").EventEmitter;
var EditSession = require("ace/edit_session").EditSession;
var Range = require("ace/range").Range;

global.DEBUG = 2;

var Client = require("ext/ot/client_mocked");

Client.onConnect({connected: true, send: noop});

var OTDocument = Client.OTDocument;


var TEST_PID = 700;

var user1 = {
    clientId: "123abc",
    userId: "123",
    fullname: "Mostafa Eweda",
    email: "mostafa@c9.io",
    fs: "rw"
};

var user2 = {
    clientId: "456abc",
    userId: "456",
    fullname: "Maged Eweda",
    email: "maged@c9.io",
    fs: "rw"
};

var ui = {
    canEdit: function() {return true;}
};

function initCollab(userIds, next) {
    var vfs = vfsLocal({ root: "/" });
    vfs.extend("collab", {file: __dirname + "/vfs.collab.js"}, function (err, meta) {
        if (err || !meta || !meta.api)
            assert.equal(err, null);
        assert.ok(meta);
        assert.ok(meta.api);
        var collab = meta.api;

        collab.connect(TEST_PID, __dirname, userIds, function (err, meta) {
            assert.equal(err, null);
            assert.ok(meta);
            assert.ok(meta.stream);

            collab.stream = meta.stream;
            collab.userIds = userIds;
            collab.meta = meta;
            collab.session = new EditSession("");
            collab.aceDocument = collab.session.doc;
            collab.otDocument = new OTDocument(collab.session, ui);
            collab.otDocument.sendJSON = function (type, data) {
                collab.send(userIds.clientId, {
                    type: type,
                    data: data
                });
            };

            setTimeout(function () {
                next(null, collab, vfs);
            }, 100);
        });
    });
}

module.exports = {

    setUpSuite: function (next) {
        execFile("rm", ["-rf", path.join(process.env.HOME, "/.c9/" + TEST_PID)], function(code, stdout, stderr) {
            if (!code)
                return next();
            next(stderr);
        });
    },

    tearDownSuite: function (next) {
        module.exports.setUpSuite(next);
    },

    setUp : function(next) {
        var _self = this;
        initCollab(user1, function (err, collab1, vfs) {
            if (err)
                return next(err);
            _self.collab1 = collab1;

            _self.vfs = vfs;
            _self.fs = fsnode(vfs);

            initCollab(user2, function (err, collab2) {
                if (err)
                    return next(err);
                _self.collab2 = collab2;

                var path = "test.txt";
                var text = 'abc-def;\nghi-jkl;\n';
                fs.writeFileSync(__dirname + "/" + path, text);
                vfsCollab.Store.newDocument({
                    path: path,
                    contents: text
                }, next);
            });
        });
    },

    tearDown: function (next) {
        var _self = this;
        this.collab2.dispose(user2.clientId);
        setTimeout(function () {
            _self.collab1.dispose(user1.clientId);
            setTimeout(next, 100);
        }, 100);
    },

    joinDocument: function (docPath, toJoin, otherCollab, next) {
        var initatorMsg, collabMsg;
        var joinerStream = toJoin.stream;
        var collabStream = otherCollab.stream;

        async.parallel([
            function (next) {
                var nextCalled = false;
                joinerStream.on("data", function (msg) {
                    console.log("MSG:", msg);
                    msg = JSON.parse(msg);
                    if (!nextCalled) {
                        if (msg.type !== "JOIN_DOC")
                            return;
                        assert.equal(msg.type, "JOIN_DOC");
                        toJoin.otDocument.init(msg.data);
                        initatorMsg = msg.data;
                        setTimeout(next, 100);
                        nextCalled = true;
                    } else {
                        if (["SYNC_COMMIT", "EDIT_UPDATE"].indexOf(msg.type) === -1 || msg.data.docId !== docPath)
                            return;
                        toJoin.otDocument.handleDocMsg(msg);
                    }
                });
            },
            function (next) {
                collabStream.on("data", function collab1Stream(msg) {
                    collabStream.removeListener("data", collab1Stream);
                    msg = JSON.parse(msg);
                    assert.equal(msg.type, "JOIN_DOC");
                    collabMsg = msg.data;
                    setTimeout(next, 100);
                });
            }
        ], function (err) {
            if (err)
                return next(err);
            assert(initatorMsg);
            assert(collabMsg);
            assert.equal(initatorMsg.docId, docPath);
            assert(initatorMsg.chunk);
            var doc = JSON.parse(initatorMsg.chunk);
            assert.equal(doc.revisions.length, 1);
            assert.ok(!collabMsg.doc);
            next(null, doc.id);
        });

        toJoin.send(toJoin.userIds.clientId, {
            type: "JOIN_DOC",
            data: {docId: docPath}
        });
    },

    "test fast normal editing (2 edits - 1 SYNC_COMMIT - reach a synced state)": function (next) {
        var _self = this;

        var docPath = "test.txt";

        _self.joinDocument(docPath, _self.collab1, _self.collab2, function (err) {
            assert.ok(!err);

            _self.joinDocument(docPath, _self.collab2, _self.collab1, function (err) {
                assert.ok(!err);

                var aceDoc1 = _self.collab1.aceDocument;
                aceDoc1.insert({row: 0, column: 0}, "insertion !\n");

                var aceDoc2 = _self.collab2.aceDocument;
                aceDoc2.insert({row: 1, column: 0}, "hub !\n");

                var collab = _self.collab1;
                var collabClientId = collab.userIds.clientId;
                setTimeout(function () {
                    assert.equal(aceDoc1.getValue(), aceDoc2.getValue());
                    next();
                }, 100);
            });
        });
    }
}

!module.parent && require("asyncjs").test.testcase(module.exports).exec();
