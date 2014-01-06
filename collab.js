/*global define console setTimeout $ global window*/
"use strict";
define(function(require, exports, module) {

main.consumes = ["Panel", "c9", "tabManager", "fs", "ui", "apf",
        "ace", "util", "collab.connect", "collab.workspace",
        "timeslider", "OTDocument", "AuthorLayer", "CursorLayer"];
    main.provides = ["collab"];
    return main;

    function main(options, imports, register) {
        var Panel        = imports.Panel;
        var c9           = imports.c9;
        var tabs         = imports.tabManager;
        var fs           = imports.fs;
        var ui           = imports.ui;
        var apf          = imports.apf;
        var ace          = imports.ace;
        var c9util       = imports.util;
        var connect      = imports["collab.connect"];
        var workspace    = imports["collab.workspace"];
        var timeslider   = imports.timeslider;
        var OTDocument   = imports.OTDocument;
        var AuthorLayer  = imports.AuthorLayer;
        var CursorLayer  = imports.CursorLayer;

        var css          = require("text!./collab.css");
        var staticPrefix = options.staticPrefix;

        var Notification = {showNotification: function() {console.warn("TODO showNotification:", arguments);}};

        var plugin       = new Panel("Ajax.org", main.consumes, {
            index        : 25,
            width        : 250,
            caption      : "Collaboration",
            className    : "collab",
            elementName  : "winCollab",
            minWidth     : 130,
            where        : "right"
        });

        var emit         = plugin.getEmitter();

        var documents    = {};

        var loaded = false;
        function load() {
            if (loaded) return;
            loaded = true;

            connect.on("message", onMessage);
            connect.on("conencting", onConnecting);
            connect.on("connect", onConnectMsg);
            connect.on("disconnect", onDisconnect);

            fs.on("beforeReadFile", beforeReadFile, plugin);
            fs.on("afterReadFile", afterReadFile, plugin);
            fs.on("beforeWriteFile", beforeWriteFile, plugin);
            fs.on("beforeRename", beforeRename, plugin);

            window.addEventListener("unload", function() {
                leaveAll();
            }, false);

            tabs.on("tabDestroy", function(e) {
                leaveDocument(e.tab.path);
            }, plugin);

            AuthorLayer.initAuthorLayer(plugin);
            CursorLayer.initCursorLayer(plugin);
        }


        var drawn = false;
        function draw(options) {
            if (drawn) return;
            drawn = true;

            ui.insertCss(css, staticPrefix, plugin);

            var bar = options.aml.appendChild(new ui.bar({
                "id"    : "winCollab",
                "skin"  : "panel-bar",
                childNodes : [
                    new apf.vsplitbox({
                        splitter : true,
                        anchors  : "0 0 0 0"
                    })
                ]
            }));
            plugin.addElement(bar);

            var html = bar.firstChild.$int;
            emit("drawPanels", { html: html, aml: bar.firstChild }, true);
        }

        function onDisconnect() {
            for(var docId in documents) {
                var doc = documents[docId];
                doc.disconnect();
            }
            throbNotification(null, "Collab disconnected");
            emit("disconnect");
        }

        function onConnecting () {
            throbNotification(null, "Collab connecting");
        }

        function onConnectMsg(msg) {
            workspace.sync(msg.data, true);

            for (var docId in documents)
                connect.send("JOIN_DOC", { docId: docId });

            throbNotification(null, msg.err || "Collab connected");
            emit("connect", null, true);
        }

        function onMessage(msg) {
            var data = msg.data || {};
            var user = data && data.userId && workspace.getUser(data.userId);
            var type = msg.type;
            var docId = data.docId;
            var doc = documents[docId];

            if (!connect.connected && type !== "CONNECT")
                return console.warn("[OT] Not connected - ignoring:", msg);

            if (data.clientId && data.clientId === workspace.myOldClientId)
                return console.warn("[OT] Skipping my own 'away' disconnection notifications");

            switch (type){
                case "CHAT_MESSAGE":
                    data.increment = true;
                    emit("chatMessage", data);
                    break;
                case "USER_JOIN":
                    workspace.sync(data);
                    user = workspace.getUser(data.userId);
                    emit("usersUpdate");
                    throbNotification(user, "came online");
                    break;
                case "USER_LEAVE":
                    emit("usersUpdate");
                    throbNotification(user, "went offline");
                    break;
                case "LEAVE_DOC":
                    doc && doc.clientLeave(data.clientId);
                    throbNotification(user, "closed file: " + docId);
                    break;
                case "JOIN_DOC":
                    if (workspace.myClientId !== data.clientId) {
                        throbNotification(user, "opened file: " + docId);
                        break;
                    }
                    doc.joinData(data);
                    break;
                default:
                    if (!doc)
                        return console.error("[OT] Received msg for unknown docId", docId, msg);
                    if (doc.loaded)
                        doc.handleMessage(msg);
                    else
                        console.warn("[OT] Doc ", docId, " not yet inited - MSG:", msg);
            }
        }

        function joinDocument(docId, document, progress, callback) {
            var docSession = document.getSession();
            var aceSession = docSession && docSession.session;
            if (!aceSession)
                console.warn("[OT] Ace session not ready - will setSession when ready !!");

            var doc = documents[docId] || new OTDocument(docId, document);

            if (aceSession)
                doc.setSession(aceSession);
            else {
                ace.on("initAceSession", function(e) {
                    if (e.doc == document)
                        doc.setSession(document.getSession().session);
                });
            }

            if (callback) {
                progress = progress || function(){};
                doc.on("joinProgress", progress);
                doc.once("joined", function(e){
                    callback(e.err, e.contents);
                    doc.off("joinProgress", progress);
                });
            }

            if (documents[docId])
                return console.warn("[OT] Document previously joined -", docId,
                "STATE: loading:", doc.loading, "loaded:", doc.loaded, "inited:", doc.inited);

            documents[docId] = doc;

            doc.on("saved", function (e) {
                onDocumentSaved(e.err, doc, e);
            });

            doc.on("joined", function(e){
                onDocumentLoaded(e.err, doc);
            });

            // test late join - document syncing - best effort
            if (connect.connected)
                doc.load();

            return doc;
        }

        function leaveDocument(docId) {
            if (!docId || !documents[docId] || !connect.connected)
                return;
            console.log("[OT] Leave", docId);
            var doc = documents[docId];
            doc.leave();
            doc.dispose();
            delete documents[docId];
        }

        function saveDocument (docId, callback) {
            var doc = documents[docId];
            doc.once("saved", function(e) {
                callback(e.err);
            });
            doc.save();
        }

        function leaveAll() {
            Object.keys(documents).forEach(function(docId) {
                leaveDocument(docId);
            });
        }

        /*
        function getDocumentsWithinPath(path) {
            var docIds = Object.keys(documents);
            var docs = [];
            for (var i = 0, l = docIds.length; i < l; ++i) {
                var doc = documents[docIds[i]];
                if (doc.id.indexOf(path) === 0)
                    docs.push(doc);
            }
            return docs;
        };
        */

        function isReadOnly() {
            return !!(c9.readonly || timeslider.visible);
        }

        function beforeReadFile(e) {
            var path = e.path;
            var tab = tabs.findTab(path);
            if (!tab)
                return;
            var args = e.args.slice();
            var progress = args.pop();
            var callback = args.pop();
            joinDocument(path, tab.document, progress, callback);
            if (connect.connected)
                return false;
            else
                return; // load through fs.xhr while collab not connected
        }

        function afterReadFile(e) {
            var path = e.path;
            var tab = tabs.findTab(path);
            var doc = documents[path];
            if (!tab || !doc || doc.loaded)
                return;
            var httpLoadedValue = tab.document.value;
            var normHttpValue = normalizeTextLT(httpLoadedValue);
            if (httpLoadedValue !== normHttpValue)
                tab.document.value = normHttpValue;
        }

        function beforeWriteFile(e) {
            var path = e.path;
            var tab = tabs.findTab(path);
            var doc = documents[path];
            if (!tab || timeslider.visible || !connect.connected || !doc || !doc.loaded)
                return;
            var args = e.args.slice();
            var progress = args.pop();
            var callback = args.pop();
            saveDocument(path, callback);
            return false;
        }

        function beforeRename(e) {
            // do collab rename
            // return false;
        }

        function normalizeTextLT(text) {
            var match = text.match(/^.*?(\r\n|\r|\n)/m);
            var nlCh = match ? match[1] : "\n";
            return text.split(/\r\n|\r|\n/).join(nlCh);
        }

        function onDocumentLoaded(err, doc) {
            if (err)
                return console.error("JOIN_DOC Error:", err);

            var tab = doc.original.tab;

            if (tab.pane.activeTab === tab)
                doc.authorLayer.refresh();

            var path = doc.docId;

            if (doc.fsHash !== doc.docHash) {
                console.log("[OT] doc latest state fs diff", path);
                tab.className.add("changed");
            }
        }

        function onDocumentSaved(err, doc, data) {
            if (err)
                return console.error("[OT] Failed saving file !", err, doc.id);
            var tab = doc.original.tab;
            if (data.clean)
                //tab.document.undoManager.reset();
                tab.className.remove("changed");
            if (data.star && timeslider.visible && timeslider.activeDocument === doc)
                timeslider.addSavedRevision(data.revision);
        }

        function throbNotification(user, msg) {
            if (!user)
                return Notification.showNotification(msg);

            var chatName = apf.escapeXML(user.fullname);
            var md5Email = user.email && apf.crypto.MD5.hex_md5(user.email.trim().toLowerCase());
            var defaultImgUrl = encodeURIComponent(c9.staticUrl + "/c9.ide.collab/images/collaborator_default-white.png");
            console.log("Collab:", user.fullname, msg);
            Notification.showNotification('<img class="gravatar-image" src="https://secure.gravatar.com/avatar/' +
                md5Email + '?s=26&d='  + defaultImgUrl + '" /><span>' +
                chatName + '<span class="notification_sub">' + msg + '</span></span>');
        }

        function openLinkedFile(path) {
            tabs.open({
                path: path
            });
        }

        /***** Lifecycle *****/

        plugin.on("load", function(){
            load();
        });
        plugin.on("draw", function(e){
            draw(e);
        });
        plugin.on("unload", function(){
            loaded = false;
            drawn = true;
        });

        plugin.freezePublicAPI({
            /**
             *
             */
            get documents() { return c9util.cloneObject(documents); },
            /**
             *
             */
            get connected() { return connect.connected; },
            /**
             *
             */
            get DEBUG()     { return connect.DEBUG; },
            /**
             *
             */
            getDocument  : function (docId) { return documents[docId]; },
            /**
             *
             */
            send          : function() { return connect.send.apply(connect, arguments); },
            /**
             *
             */
            joinDocument  : joinDocument,
            /**
             *
             */
            leaveDocument : leaveDocument,
            /**
             *
             */
            leaveAll      : leaveAll
        });

        register(null, {
            "collab": plugin
        });
    }
});
