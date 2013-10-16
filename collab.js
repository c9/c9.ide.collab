/*global define console setTimeout $ global window*/
"use strict";
define(function(require, exports, module) {

main.consumes = ["Plugin", "c9", "tabManager", "fs", "apf", "ui",
        "settings", "menus", "commands", "save", "ace", "timeslider",
        "collab.util", "collab.connect", "OTDocument", "AuthorLayer", "CursorLayer"];
    main.provides = ["collab"];
    return main;

    function main(options, imports, register) {
        var Plugin       = imports.Plugin;
        var c9           = imports.c9;
        var tabs         = imports.tabManager;
        var fs           = imports.fs;
        var apf          = imports.apf;
        var ui           = imports.ui;
        var settings     = imports.settings;
        var menus        = imports.menus;
        var commands     = imports.commands;
        var save         = imports.save;
        var ace          = imports.ace;
        var util         = imports["collab.util"];
        var connect      = imports["collab.connect"];
        var timeslider   = imports.timeslider;
        var OTDocument   = imports.OTDocument;
        var AuthorLayer  = imports.AuthorLayer;
        var CursorLayer  = imports.CursorLayer;

        var Notification = {showNotification: function() {console.warn("TODO showNotification:", arguments);}};

        var plugin          = new Plugin("Ajax.org", main.consumes);
        var emit            = plugin.getEmitter();

        var activeDocument;
        var tsVisibleKey    = "user/collab/@timeslider-visible";
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

            tabs.on("tabDestroy", function(e) {
                leaveDocument(e.tab.path);
            }, plugin);

            tabs.on("focusSync", function(e) {
                setActiveDocument(Docs[e.tab.path]);
            }, plugin);

            AuthorLayer.initAuthorLayer(plugin);
            CursorLayer.initCursorLayer(plugin);

            // Timeslider logic (can't be moved to timeslider.js because of a dependency cycle)
            var timesliderKeyboardHandler = {
                handleKeyboard: function(data, hashId, keystring) {
                    if (keystring == "esc") {
                        forceHideSlider();
                        return {command: "null"};
                    }
                }
            };

            commands.addCommand({
                name: "toggleTimeslider",
                exec: toggleTimeslider,
                isAvailable: timesliderAvailable
            }, plugin);

            commands.addCommand({
                name: "forceToggleTimeslider",
                exec: function(){
                    var isVisible = settings.getBool(tsVisibleKey);
                    settings.set(tsVisibleKey, !isVisible);
                    toggleTimeslider();
                },
                isAvailable: timesliderAvailable
            }, plugin);

            menus.addItemByPath("File/File Revision History...", new ui.item({
                type: "check",
                checked: "[{settings.model}::" + tsVisibleKey + "]",
                command: "toggleTimeslider"
            }), 600, plugin);

            settings.on("read", function () {
                // force-hide-timeslider with initial loading
                settings.set(tsVisibleKey, false);
            }, plugin);

            // right click context item in ace
            var mnuCtxEditorFileHistory = new ui.item({
                caption: "File History",
                command: "forceToggleTimeslider"
            }, plugin);

            ace.getElement("menu", function(menu) {
                menus.addItemToMenu(menu, mnuCtxEditorFileHistory, 600, plugin);
                menus.addItemToMenu(menu, new ui.divider(), 650, plugin);
                menu.on("prop.visible", function(e) {
                    // only fire when visibility is set to true
                    if (e.value) {
                        var editor = tabs.getPage().$editor;
                        if (timesliderAvailable(editor))
                            mnuCtxEditorFileHistory.enable();
                        else
                            mnuCtxEditorFileHistory.disable();
                    }
                });
            });

            tabs.on("paneDestroy", function (e){
                if (!tabs.getPanes(tabs.container).length)
                    forceHideSlider();
            }, plugin);

            tabs.on("focusSync", function(e) {
                var docId = e.tab.path;
                var doc = Docs[docId];
                if (timeslider.visible && (!doc || !doc.isInited || !doc.revisions || !doc.revisions[0]))
                    forceHideSlider();
            }, plugin);

            save.on("beforeSave", function(e) {
                if (timeslider.visible)
                    return false;
            }, plugin);

            timeslider.onSlider(function (revNum) {
                var tab = tabs.focussedTab;
                var doc = Docs[tab.path];
                if (!doc || !timeslider.visible)
                    return;

                doc.updateToRevNum(revNum);
            });
            // End of timeslider logic
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

            throbNotification(null, msg.err || "Collab connected");
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
                    data.increment = true;
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
                    doc && doc.leave(data.clientId);
                    // throbNotification(user, "closed file: " + data.docId);
                    chatNotification(user, "closed file: ", data.docId);
                    break;
                case "JOIN_DOC":
                    if (workspace.myClientId !== data.clientId) {
                        // throbNotification(user, "opened file: " + data.docId);
                        chatNotification(user, "opened file: ", data.docId);
                        break;
                    }
                    doc.joinData(data);
                    break;
                default:
                    if (!doc)
                        return console.error("[OT] Received msg for unknown docId", docId, msg);
                    if (doc.isInited)
                        doc.handleMessage(msg);
                    else
                        console.warn("[OT] Doc ", docId, " not yet inited - MSG:", msg);
            }
        }

        function joinDocument(docId, document, progress, callback) {
            if (Docs[docId] && Docs[docId].isInited)
                return console.warn("[OT] Doc already inited...");

            var aceEditor = document.editor.ace;
            var session = document.getSession().session;

            var doc = session.collabDoc = Docs[docId] = new OTDocument(docId, session, document, workspace);

            if (progress) {
                doc.on("joinProgress", progress);
                doc.once("joined", function(e){
                    callback(e.err, e.contents);
                    doc.off("joinProgress", progress);
                });
            }

            doc.once("joined", function(e){
                emit("documentLoaded", {err: e.err, doc: doc});
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

            if (activeDocument === doc)
                activeDocument = null;

            delete Docs[docId];
        }

        function saveDocument (docId, callback) {
            var doc = Docs[docId];
            doc.once("saved", function (err, saveData) {
                callback.apply(null, arguments);
                emit("documentSaved", {err: err, data: saveData});
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
            var doc = Docs[path];
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
            var doc = Docs[path];
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

        function onDocumentLoaded(e) {
            if (e.err)
                return console.error("JOIN_DOC Error:", err);

            var doc = e.doc;
            var original = doc.original;
            var tab = original.tab;

            if (tabs.focussedTab === tab) {
                activeDocument = doc;
                doc.authorLayer.refresh();
            }

            var path = doc.docId;

            if (doc.fsHash !== doc.docHash) {
                console.log("[OT] doc latest state fs diff", path);
                tab.className.add("changed");
            }
        }

        function onDocumentSaved(e) {
            if (e.err)
                return;
            var data = e.data;
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
            notif.increment = increment;
            emit("chatMessage", notif);
        }

        function setActiveDocument(doc) {
            if (activeDocument && activeDocument.isInited)
                activeDocument.cursorLayer.hideAllTooltips();
            activeDocument = doc;
            if (doc && timeslider.visible)
                doc.loadTimeslider();
        }

        function getUser(uid) {
            return workspace.users[uid];
        }

        // Timeslider-specific logic
        function toggleTimeslider() {
            var tab = tabs.focussedTab;
            if (!tab || !tab.path)
                return;
            var doc = Docs[tab.path];
            var aceEditor = tab.editor.ace;
            if (timeslider.visible) {
                hide();
                if (doc && doc.isInited) {
                    doc.updateToRevNum();
                    if (doc.changed)
                        tab.className.add("changed");
                    else
                        tab.className.remove("changed");
                }
                aceEditor.keyBinding.removeKeyboardHandler(timesliderKeyboardHandler);
                aceEditor.setReadOnly(!!c9.readonly);
            }
            else {
                if (!doc || !doc.revisions[0])
                    return;
                // ide.dispatchEvent("track_action", {type: "timeslider"});
                timeslider.show();
                aceEditor.setReadOnly(true);
                collab.activeDocument = doc;
                aceEditor.keyBinding.addKeyboardHandler(timesliderKeyboardHandler);
            }
            aceEditor.renderer.onResize(true);
        }

        function timesliderAvailable(editor){
            if (!editor || editor.path != "ext/code/code")
                return false;
            var aceEditor = editor.ace;
            var collabDoc = aceEditor.session.collabDoc;
            return collabDoc && collabDoc.isInited && collabDoc.revisions[0];
        }

        function forceHideSlider() {
            var isVisible = settings.getBool(tsVisibleKey);
            if (isVisible) {
                settings.set(tsVisibleKey, false);
                toggleTimeslider();
            }
        }

        /***** Lifecycle *****/
        // Make sure the available event is always called
        plugin.on("newListener", function(event, listener){
            if (event == "connect" && connect.connected)
                listener(workspace);
        });

        plugin.on("load", function(){
            load();
        });
        plugin.on("enable", function(){

        });
        plugin.on("disable", function(){

        });
        plugin.on("unload", function(){
            loaded = false;
        });

        plugin.freezePublicAPI({
            get documents() { return util.cloneObject(Docs); },
            get connected() { return connect.connected; },
            get DEBUG()     { return connect.DEBUG; },
            get workspace() { return workspace; },
            get activeDocument() { return activeDocument; },
            set activeDocument(doc) { setActiveDocument(doc); },

            getDocument  : function (docId) { return Docs[docId]; },
            getUser      : function (uid)   { return getUser(uid); },
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
