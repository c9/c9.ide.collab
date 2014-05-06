"use strict";
"use server";

var assert = require("assert");
var async = require("async");
var vfsLocal = require("vfs-local");
var fsnode = require("vfs-nodefs-adapter");

var fs = require("fs");
var vfsCollab = require("./collab-server");
var execFile = require("child_process").execFile;
var path = require("path");

var TEST_PID = 800;

var user1 = {
    user: {
        uid: "123",
        fullname: "Mostafa Eweda",
        email: "mostafa@c9.io"
    },
    clientId: "123abc",
    readonly: false
};

var user2 = {
    user: {
        uid: "456",
        fullname: "Maged Eweda",
        email: "maged@c9.io",
    },
    clientId: "456abc",
    readonly: false
};

function initCollab(user, next) {
    var vfs = vfsLocal({ root: "/" });
    vfs.extend("collab", {
        file: __dirname + "/collab-server.js",
        redefine: true,
        user: user.user,
        project: {pid: TEST_PID},
        readonly: user.readonly
    }, function (err, meta) {
        if (err || !meta || !meta.api)
            assert.equal(err, null);
        assert.ok(meta);
        assert.ok(meta.api);
        var collab = meta.api;

        collab.connect(__dirname, user.clientId, function (err, meta) {
            assert.equal(err, null);
            assert.ok(meta);
            assert.ok(meta.stream);

            collab.stream = meta.stream;
            collab.user = user;
            collab.meta = meta;
            setTimeout(function () {
                next(null, collab, vfs);
            }, 100);
        });
    });
}

module.exports = {

    timeout: 10000,

    setUpSuite: function (next) {
        execFile("rm", ["-rf", path.join(process.env.HOME, "/.c9/" + TEST_PID)], function(code, stdout, stderr) {
            if (!code)
                return next();
            next(stderr);
        });
    },

    tearDownSuite: function (next) {
        fs.unlinkSync(__dirname + "/test.txt");
        module.exports.setUpSuite(next);
    },

    setUp: function(next) {
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
                var text = 'abc-def;;\nghi"-"jkl\n';
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
        this.collab2 && this.collab2.dispose(user2.clientId);
        setTimeout(function () {
            _self.collab1 && _self.collab1.dispose(user1.clientId);
            setTimeout(next, 100);
        }, 100);
    },

    "test 2 clients collab initialization" : function() {
        var collab1 = this.collab1;
        var collab2 = this.collab2;
        assert.ok(collab1);
        assert.ok(collab2);
        assert.ok(collab1.meta.isMaster);
        assert.ok(!collab2.meta.isMaster);
    },

    "test broadcasting server" : function(next) {
        this.collab1.stream.on("data", function (data) {
            console.log("Stream data:", data.toString());
            next();
        });
        this.collab1.send(user1.clientId, {type:"PING"});
    },

    "test stream end on dispose": function (next) {
        this.collab1.stream.on("end", function (data) {
            next();
        });
        this.collab1.dispose(user1.clientId);
    },

    joinDocument: function (docPath, toJoin, otherCollab, next) {
        var initatorMsg, collabMsg;
        var joinerStream = toJoin.stream;
        var collabStream = otherCollab.stream;

        async.parallel([
            function (next) {
                joinerStream.on("data", function collab2Stream(msg) {
                    joinerStream.removeListener("data", collab2Stream);
                    msg = JSON.parse(msg);
                    assert.equal(msg.type, "JOIN_DOC");
                    initatorMsg = msg.data;
                    next();
                });
            },
            function (next) {
                collabStream.on("data", function collab1Stream(msg) {
                    collabStream.removeListener("data", collab1Stream);
                    msg = JSON.parse(msg);
                    assert.equal(msg.type, "JOIN_DOC");
                    collabMsg = msg.data;
                    next();
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
            assert.ok(!collabMsg.doc);
            next(null, doc.id);
        });

        toJoin.send(toJoin.user.clientId, {
            type: "JOIN_DOC",
            data: {docId: docPath}
        });
    },

    "test join document from master": function (next) {
        this.joinDocument("test.txt", this.collab1, this.collab2, next);
    },

    "test join document from slave": function (next) {
        this.joinDocument("test.txt", this.collab2, this.collab1, next);
    },

    "!test leave document": function (next) {
        var _self = this;

        var docPath = "test.txt";

        _self.joinDocument(docPath, _self.collab1, _self.collab2, function (err) {
            assert.ok(!err);

            _self.joinDocument(docPath, _self.collab2, _self.collab1, function (err) {

                assert.ok(!err);
                var numLeaves = 2;

                function assertLeaveMsg(next, msg) {
                    if (!numLeaves)
                        return;
                    numLeaves--;
                    msg = JSON.parse(msg);
                    assert.equal(msg.type, "LEAVE_DOC");
                    var data = msg.data;
                    assert.equal(msg.data.clientId, collabClientId);
                    next();
                }

                async.parallel([
                    function (next) {
                        _self.collab1.stream.on("data", assertLeaveMsg.bind(null, next));
                    },
                    function (next) {
                        _self.collab2.stream.on("data", assertLeaveMsg.bind(null, next));
                    }
                ], next);

                var collab = _self.collab1;
                var collabClientId = collab.userIds.clientId;
                // Anyone can leave -- everybody notified
                collab.send(collabClientId, {
                    type: "LEAVE_DOC",
                    data: {docId: docPath}
                });
            });
        });
    },


    "test editing document - sync commit error": function (next) {
        var _self = this;

        var docPath = "test.txt";

        _self.joinDocument(docPath, _self.collab2, _self.collab1, function (err) {
            assert.ok(!err);

            _self.collab2.stream.on("data", function (msg) {
                msg = JSON.parse(msg);
                assert.equal(msg.type, "SYNC_COMMIT");
                assert.equal(msg.data.docId, docPath);
                assert.equal(msg.data.revNum, 0);
                next();
            });

            _self.collab2.send(user2.clientId, {
                type: "EDIT_UPDATE",
                data: {
                    docId: docPath,
                    revNum: 2, // commit with wrong revision number ( != 1 )
                    op: ["r1", "ik", "r209"]
                }
            });
        });
    },

    "test editing document - a single commit": function (next) {
        var _self = this;

        var docPath = "test.txt";

        _self.joinDocument(docPath, _self.collab1, _self.collab2, function (err) {
            assert.ok(!err);

            _self.joinDocument(docPath, _self.collab2, _self.collab1, function (err) {

                assert.ok(!err);

                // will be received by both joined collab streams
                _self.collab2.stream.on("data", function (msg) {
                    msg = JSON.parse(msg);
                    assert.equal(msg.type, firstEditMsg.type);
                    assert.equal(msg.data.docId, firstEditMsg.data.docId);
                    assert.equal(msg.data.revNum, firstEditMsg.data.revNum);
                    assert.deepEqual(msg.data.op, firstEditMsg.data.op);
                    next();
                });

                var firstEditMsg = {
                    type: "EDIT_UPDATE",
                    data: {
                        docId: docPath,
                        revNum: 1,
                        op: ["r1", "ik", "r209"]
                    }
                };
                // Anyone can leave -- everybody notified
                _self.collab1.send(user1.clientId, firstEditMsg);
            });
        });
    },

    "test the master leaving and re-connecting": function (next) {
        var _self = this;
        this.collab1.dispose(user1.clientId);
        setTimeout(function () {
            initCollab(user1, function(err, collab1) {
                assert.ok(!err);
                _self.collab1 = collab1;
                next();
            });
        }, 1000);
    },

    "test a participant leaving and re-connecting": function (next) {
        var _self = this;
        this.collab2.dispose(user2.clientId);
        initCollab(user2, function(err, collab2) {
            assert.ok(!err);
            _self.collab2 = collab2;
            next();
        });
    }
};

!module.parent && require("asyncjs").test.testcase(module.exports).exec();
