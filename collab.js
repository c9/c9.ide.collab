/*global define console setTimeout $ global window*/
"use strict";
define(function(require, exports, module) {

main.consumes = ["Plugin", "c9", "tabManager", "fs", "apf", "ui",
        "collab.util", "collab.connect", "timeslider", "chat", "OTDocument"];
    main.provides = ["collab"];
    return main;

    function main(options, imports, register) {
        var Plugin       = imports.Plugin;
        var c9           = imports.c9;
        var tabs         = imports.tabManager;
        var fs           = imports.fs;
        var apf          = imports.apf;
        var ui           = imports.ui;
        var util         = imports["collab.util"];
        var connect      = imports["collab.connect"];
        var timeslider   = imports.timeslider;
        var chat         = imports.chat;
        var OTDocument   = imports.OTDocument;

        var plugin          = new Plugin("Ajax.org", main.consumes);
        var emit            = plugin.getEmitter();

        var Docs            = {};
        var workspace       = { authorPool: {}, colorPool: {}, users: {} };

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

            // TODO: from here
            tabs.on("someCloseEvent", function(e) {
                leaveDocument(e.tab.path);
            }, plugin);

            tabs.on("tab.afterswitch", function(e) {
                var page = e.nextPage;
                var doc = Client.getDoc(page.name);
                if (!doc || !doc.ot)
                    return;

                if (doc.isInited) {
                    activeDoc = doc.ot;
                    if (!doc.revisions[0])
                        forceHideSlider();
                }
            }, plugin);

            tabs.on("tab.beforeswitch", function(e) {
                var editor = Editors.currentEditor && Editors.currentEditor.amlEditor && Editors.currentEditor.amlEditor.$editor;
                if(!editor)
                    return;
                clearTimeout(editor.cursorTooltipTimeout);
                delete editor.cursorTooltipTimeout;
                clearTimeout(editor.authorTooltipTimeout);
                delete editor.authorTooltipTimeout;
                var collabDoc = editor.session.collabDoc;
                if (collabDoc && collabDoc.isInited && collabDoc.cursors.tooltipIsOpen)
                    collabDoc.cursors.hideAllTooltips();
            }, plugin);

            function updateSettings() {
                var page = tabs.focussedTab;
                if (!page)
                    return;
                var doc = Client.getDoc(page.name);
                if (!doc || !doc.isInited)
                    return;
                if (doc.authorLayer)
                    doc.authorLayer.refresh();
                var aceEditor = page.editor.ace;
                if (aceEditor.tooltip)
                    aceEditor.tooltip.style.display = "none";
            }

            // ide.addEventListener("settings.save", updateSettings);
            // settings.model.addEventListener("update", updateSettings);

            // ide.addEventListener("settings.load", function(e){
            //     settings.setDefaults("general", [["timeslidervisible", "false"]]);

            //     // Can't initially open the timeslider -- the Collab client is probably not yet connected
            //     settings.model.setQueryValue("general/@timeslidervisible", "false");

            //     updateSettings();
            // });
        }

        function onDisconnect() {
            for(var docId in Docs) {
                var doc = Docs[docId];
                doc.isInited = false;
            }
            throbNotification(null, "Collab disconnected");
            emit("disconnect");
        }

        function onConnecting () {
            throbNotification(null, "Collab connecting");
        }

        function onConnectMsg(msg) {
            if (workspace.myClientId !== msg.data.myClientId)
                workspace.myOldClientId = workspace.myClientId;
            else
                workspace.myOldClientId = null;
            syncWorkspace(msg.data);

            for (var docId in Docs)
                connect.send("JOIN_DOC", { docId: docId });

            throbNotification(null, e.err || "Collab connected");
            emit("connect", workspace);
        }

        function syncWorkspace(data) {
            var wsIgnore = {clientId: true, userId: true};
            for (var key in data)
                if (!wsIgnore[key])
                    workspace[key] = data[key];
        }

        function onMessage(msg) {
            var data = msg.data || {};
            var user = data && data.userId && getUser(data.userId);
            var type = msg.type;
            var docId = data.docId;
            var doc = Docs[docId];

            if (!connect.connected && type !== "CONNECT")
                return console.warn("[OT] Not connected - ignoring:", msg);

            if (data.clientId && data.clientId === workspace.myOldClientId)
                return console.warn("[OT] Skipping my own 'away' disconnection notifications");

            switch (type){
                case "CHAT_MESSAGE":
                    emit("chatMessage", data);
                    break;
                case "USER_JOIN":var user = data && data.userId && _self.getUser(data.userId);
                    syncWorkspace(data);
                    emit("usersUpdate");
                    throbNotification(user, "came online");
                    chatNotification(user, "came online");
                    break;
                case "USER_LEAVE":
                    emit("usersUpdate");
                    throbNotification(user, "went offline");
                    chatNotification(user, "went offline");
                    break;
                case "LEAVE_DOC":
                    doc && doc.ot.leave(data.clientId);
                    // throbNotification(user, "closed file: " + data.docId);
                    chatNotification(user, "closed file: ", data.docId);
                    break;
                case "JOIN_DOC":
                    if (workspace.myClientId !== data.clientId) {
                        // throbNotification(user, "opened file: " + data.docId);
                        chatNotification(user, "opened file: ", data.docId);
                        break;
                    }
                    doc.ot.joinData(data);
                    break;
                default:
                    if (!doc)
                        return console.error("[OT] Received msg for unknown docId", docId, msg);
                    if (doc.isInited)
                        doc.ot.handleMessage(msg);
                    else
                        console.warn("[OT] Doc ", docId, " not yet inited - MSG:", msg);
            }
        }

        function joinDocument(docId, document, progress, callback) {
            if (Docs[docId] && Docs[docId].isInited)
                return console.warn("[OT] Doc already inited...");

            var aceEditor = document.editor.ace;
            var session = document.getSession().session;

            var doc = new OTDocument(docId, session, document);
            session.collabDoc = doc;

            if (progress) {
                doc.on("joinProgress", progress);
                doc.once("joined", function(){
                    callback.apply(null, arguments);
                    doc.off("joinProgress", progress);
                });
            }

            doc.once("joined", function(err){
                emit("documentLoaded", err, doc);
            });

            // test late join - document syncing - best effort
            if (connect.connected)
                connect.send("JOIN_DOC", { docId: docId });

            return doc;
        }

        function leaveDocument(docId) {
            if (!docId || !Docs[docId] || !connect.connected)
                return;

            console.log("[OT] Leave", docId);

            connect.send("LEAVE_DOC", { docId: docId });

            var doc = Docs[docId];
            doc.dispose();

            if (activeDoc === doc)
                activeDoc = null;

            delete Docs[docId];
        }

        function saveDocument (docId, callback) {
            var doc = Docs[docId];
            doc.once("saved", function (err, saveData) {
                callback.apply(null, arguments);
                emit("documentSaved", err, saveData);
            });
            doc.save();
        }

        function leaveAll() {
            Object.keys(Docs).forEach(function(docId) {
                leaveDocument(docId);
            });
        }

        /*
        function getDocsWithinPath(path) {
            var docIds = Object.keys(Docs);
            var docs = [];
            for (var i = 0, l = docIds.length; i < l; ++i) {
                var doc = Docs[docIds[i]];
                if (doc.id.indexOf(path) === 0)
                    docs.push(doc);
            }
            return docs;
        };
        */

        var activeDoc;

        function setActiveDoc(doc) {
            activeDoc = doc;
            if (timeslider.visible)
                doc.loadTimeslider();
        }

        function isReadOnly() {
            return !!(c9.readonly || timeslider.visible);
        }

        function beforeReadFile(e) {
            var path = e.path;
            var tab = tabs.findTab(path);
            if (!tab)
                return;
            var args = e.args;
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
            var doc = getDocument(path);
            if (!tab || !doc || doc.isInited)
                return;
            var httpLoadedValue = tab.document.value;
            var normHttpValue = normalizeTextLT(httpLoadedValue);
            if (httpLoadedValue !== normHttpValue)
                tab.document.value = normHttpValue;
            doc.fsContents = normHttpValue;
        }

        function beforeWriteFile(e) {
            var path = e.path;
            var tab = tabs.findTab(path);
            var doc = getDocument(path);
            if (!tab || timeslider.visible || !connect.connected || !doc || !doc.isInited)
                return;
            var args = e.args;
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

        plugin.on("documentLoaded", onDocumentLoaded, plugin);
        plugin.on("documentSaved", onDocumentSaved, plugin);

        function onDocumentLoaded(err, doc) {
            if (err)
                return console.error("JOIN_DOC Error:", err);

            var original = doc.original;
            var tab = original.tab;

            if (tabs.focussedTab === tab) {
                activeDoc = doc;
                doc.authorLayer.refresh();
            }

            var path = doc.docId;

            if (doc.fsHash !== doc.docHash) {
                console.log("[OT] doc latest state fs diff", path);
                tab.className.add("changed");
            }
        }

        function onDocumentSaved(err, data) {
            if (err)
                return;
            var tab = tabs.findTab(data.docId);
            if (!tab)
                return;
            if (data.clean)
                //tab.document.undoManager.reset();
                tab.className.remove("changed");
            if (tabs.focussedTab === tab && timeslider.visible && data.star)
                timeslider.addSavedRevision(data.revision);
        }

        function throbNotification(user, msg) {
            if (!user)
                return Notification.showNotification(msg);

            var chatName = ui.escapeXML(user.fullname);
            var md5Email = user.email && apf.crypto.MD5.hex_md5(user.email.trim().toLowerCase());
            var defaultImgUrl = encodeURIComponent(c9.staticPrefix + "/ext/collaborate/images/room_collaborator_default-white.png");
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

        function chatNotification(user, msg, path) {
            var notif = {
                id: Date.now(),
                timestamp: Date.now(),
                userId: user.uid,
                text: msg,
                notification: {}
            };
            var increment = false;
            if (path) {
                notif.notification = {
                    linkText: path,
                    linkHandler: openLinkedFile.bind(null, path)
                };
                increment = true;
            }
            chat.addMessage(notif, increment);
        }

        // Make sure the available event is always called
        plugin.on("newListener", function(event, listener){
            if (event == "connect" && connect.connected)
                listener(workspace);
        });

        plugin.freezePublicAPI({
            get documents() { return util.cloneObject(Docs); },
            get connected() { return connect.connected; },
            get DEBUG()     { return connect.DEBUG; },
            get workspace() { return workspace; },

            getDocument  : function (docId) { return Docs[docId]; },
            getUser      : function (uid)   { return workspace.users[uid]; },
            getUserColor : function (uid)   { return (uid && util.formatColor(workspace.colorPool[uid])) || "transparent"; },

            send          : function() { return connect.send.apply(connect, arguments); },
            joinDocument  : joinDocument,
            leaveDocument : leaveDocument,
            leaveAll      : leaveAll
        });

        register(null, {
            "collab": plugin
        });
    }
});
