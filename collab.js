/*global define console setTimeout $ global window*/
"use strict";
define(function(require, exports, module) {

main.consumes = ["Panel", "c9", "tabManager", "fs", "ui", "apf", "settings", "preferences",
        "ace", "util", "collab.connect", "collab.workspace", "timeslider", "OTDocument"];
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
        var util         = imports.util;
        var settings     = imports.settings;
        var prefs        = imports.preferences;
        var connect      = imports["collab.connect"];
        var workspace    = imports["collab.workspace"];
        var timeslider   = imports.timeslider;
        var OTDocument   = imports.OTDocument;

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

        // open collab documents
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

            ui.insertCss(css, staticPrefix, plugin);

            window.addEventListener("unload", function() {
                leaveAll();
            }, false);

            tabs.on("tabDestroy", function(e) {
                leaveDocument(e.tab.path);
            }, plugin);

            // Author layer settings
            var showAuthorInfoKey = "user/collab/@show-author-info";
            prefs.add({
                "General" : {
                    "Collaboration" : {
                        "Show Authorship Info" : {
                            type     : "checkbox",
                            position : 8000,
                            path     : showAuthorInfoKey
                        }
                    }
                }
            }, plugin);

            settings.on("read", function () {
                settings.setDefaults("usr/collab", [["show-author-info", true]]);
                refreshActiveDocuments();
            }, plugin);

            settings.on("user/collab", function () {
                refreshActiveDocuments();
            }, plugin);
        }

        var drawn = false;
        function draw(options) {
            if (drawn) return;
            drawn = true;

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
            throbNotification("Collab disconnected");
            emit("disconnect");
        }

        function onConnecting () {
            throbNotification("Collab connecting");
        }

        function onConnectMsg(msg) {
            workspace.sync(msg.data, true);

            for (var docId in documents)
                documents[docId].load();

            throbNotification(msg.err || "Collab connected");
            emit("connect");
        }

        function onMessage(msg) {
            var data = msg.data || {};
            var user = data && data.userId && workspace.getUser(data.userId);
            var type = msg.type;
            var docId = data.docId;
            if (docId && docId[0] !== "/")
                docId = data.docId = "/" + docId;
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
                    throbNotification("came online", user);
                    break;
                case "USER_LEAVE":
                    // TODO: sync workspace & show user as offline in the members panel
                    throbNotification("went offline", user);
                    break;
                case "LEAVE_DOC":
                    doc && doc.clientLeave(data.clientId);
                    throbNotification("closed file: " + docId, user);
                    break;
                case "JOIN_DOC":
                    if (workspace.myClientId !== data.clientId) {
                        throbNotification("opened file: " + docId, user);
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

        /**
         * Join a document and report progress and on-load contents
         * @param {String} docId
         * @param {Document} doc
         * @param {Function} progress
         * @param {Function} callback
         */
        function joinDocument(docId, doc, progress, callback) {
            var docSession = doc.getSession();
            var aceSession = docSession && docSession.session;
            if (!aceSession)
                console.warn("[OT] Ace session not ready - will setSession when ready !!");

            var otDoc = documents[docId] || new OTDocument(docId, doc);

            if (aceSession)
                otDoc.setSession(aceSession);
            else {
                ace.on("initAceSession", function(e) {
                    if (e.doc == doc)
                        otDoc.setSession(doc.getSession().session);
                });
            }

            if (callback) {
                progress = progress || function(){};
                otDoc.on("joinProgress", progress);
                otDoc.once("joined", function(e){
                    callback(e.err, e.contents);
                    otDoc.off("joinProgress", progress);
                });
            }

            if (documents[docId])
                return console.warn("[OT] Document previously joined -", docId,
                "STATE: loading:", otDoc.loading, "loaded:", otDoc.loaded, "inited:", otDoc.inited);

            documents[docId] = otDoc;

            // test late join - document syncing - best effort
            if (connect.connected)
                otDoc.load();

            return otDoc;
        }

        function leaveDocument(docId) {
            if (!docId || !documents[docId] || !connect.connected)
                return;
            console.log("[OT] Leave", docId);
            var doc = documents[docId];
            doc.leave(); // will also dispose
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

        function refreshActiveDocuments() {
            for (var docId in documents) {
                var doc = documents[docId];
                var tab = doc.original.tab;
                if (tab.pane.activeTab === tab && doc.inited)
                    doc.authorLayer.refresh();
            }
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
            if (!documents[path])
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

        function throbNotification(msg, user) {
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

        plugin.on("newListener", function(event, listener){
            if (event == "connect" && connect.connected)
                listener();
        });

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
            _events : [
                /**
                 * Fires when the collab panel is first drawn to enable sub-collab-panels to listen and render correctly
                 * @event drawPanels
                 * @param {Object}   e
                 * @param {HTMLElement}   e.html  the html element to build collan panels on top of
                 * @param {AMLElement}    e.aml   the apf element to build collan panels on top of
                 */
                "drawPanels",
                /**
                 * Fires when the collab is connected and the collab workspace is synced
                 * @event connect
                 */
                "connect",
                /**
                 * Fires when a chat message arrives (the chat plugin should listen to it to get chat messages)
                 * @event chatMessage
                 * @param {Object}   e
                 * @param {String}   e.userId     the chat message author user id
                 * @param {String}   e.text       the chat text to diaplay
                 * @param {Boolean}  e.increment  should the chat counter be incremented (not yet implemented)
                 */
                "chatMessage",
            ],
            /**
             * Get a clone of open collab documents
             * @property {Object} documents
             */
            get documents() { return util.cloneObject(documents); },
            /**
             * Specifies whether the collab is connected or not
             * @property {Boolean} connected
             */
            get connected() { return connect.connected; },
            /**
             * Specifies whether the collab debug is enabled or not
             * @property {Boolean} debug
             */
            get debug()     { return connect.debug; },
            /**
             * Get the open collab document with path
             * @param  {String}     path the file path of the document
             * @return {OTDocument} the collab document open with this path
             */
            getDocument  : function (path) { return documents[path]; },
            /**
             * Send a message to the collab server
             * @param  {String}     type    the type of the message
             * @param  {Object}     message the message body to send
             */
            send          : function(type, message) { connect.send(type, message); }
        });

        register(null, {
            "collab": plugin
        });
    }
});
