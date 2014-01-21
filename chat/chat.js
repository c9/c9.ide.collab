define(function(require, exports, module) {
"use strict";

    main.consumes = ["CollabPanel", "ui", "panels", "collab.util", "collab.workspace", "collab"];
    main.provides = ["chat"];
    return main;

    function main(options, imports, register) {
        var CollabPanel  = imports.CollabPanel;
        var ui           = imports.ui;
        var panels       = imports.panels;
        var util         = imports["collab.util"];
        var workspace    = imports["collab.workspace"];
        var collab       = imports.collab;

        var html         = require("text!./chat.html");
        var css          = require("text!./chat.css");
        var timeago      = require("./timeago");
        var staticPrefix = options.staticPrefix;

        var ROLE_NONE         = "n";
        var ROLE_VISITOR      = "v";
        var ROLE_COLLABORATOR = "c";
        var ROLE_ADMIN        = "a";

        var plugin = new CollabPanel("Ajax.org", main.consumes, {
            index        : 200,
            caption      : "Group Chat",
            textselect   : true
        });

        // var emit  = plugin.getEmitter();
        var emoji = require("./my_emoji");

        // panel-relared UI elements
        var chatInput, chatText;
        // non-panel related UI elements
        var chatThrob, chatCounter, chatNotif;

        var loaded = false;
        function load() {
            if (loaded) return;
            loaded = true;

            collab.on("chatMessage", onChatMessage);
        }

        var drawn = false;
        function draw(options) {
            if (drawn) return;
            drawn = true;

            drawNonPanelElements();

            var parent = options.html;
            parent.className += " chatContainer";

            chatText = parent.appendChild(document.createElement("div"));
            chatText.setAttribute("class", "chatText");

            chatInput = new apf.codebox({
                htmlNode         : parent,
                skin             : "codebox",
                "initial-message": "Hello World!",
                clearbutton      : "true",
                focusselect      : "true"
            });

            plugin.addElement(chatInput);

            function onWorkspaceSync() {
                if (!/r/.test(workspace.fs))
                    return console.warn("Don't have read access - You can't use chat");
                var chatHistory = workspace.chatHistory;
                chatHistory.forEach(function(msg){
                    addMessage(msg, msg.increment);
                });
                scrollDown();
                chatCounter.innerHTML = chatHistory.length;
            }

            chatInput.ace.setOption("wrap", "free");
            chatInput.ace.commands.addCommands([
                {
                    bindKey : "ESC",
                    exec    : function(){
                        if (chatInput.getValue())
                            chatInput.setValue("");
                        else
                            collab.hide();
                    }
                }, {
                    bindKey : "Enter",
                    exec    : send
                }
            ]);

            function listenWorkspaceSync() {
                workspace.off("sync", onWorkspaceSync);
                workspace.on("sync", onWorkspaceSync);
            }

            if (panels.isActive("collab"))
                listenWorkspaceSync();

            collab.on("show", function(){
                chatInput.focus();
                listenWorkspaceSync();
            });

            collab.on("hide", function(){
                workspace.off("sync", onWorkspaceSync);
            });
        }

        var seenMsgs = {};
        var throbTimeout;

        function scrollDown() {
            var chatMessages = chatText.getElementsByTagName("p");
            if (!chatMessages.length)
                return;
            var lastMessage = chatMessages[chatMessages.length-1];
            lastMessage.scrollIntoView();
        }

        function isOpen() {
            return panels.isActive("collab");
        }

        function send() {
            var text = chatInput.getValue().trim();
            if (!text)
                return;
            text = emoji.toEmojiUnicode(text);
            collab.send("CHAT_MESSAGE", { text: text });
            chatInput.setValue("");
            // ide.dispatchEvent("track_action", {type: "chat"});
        }

        function getAuthorName(userId) {
            if (userId == workspace.myUserId)
                return "You";

            var user = workspace.users[userId];
            return util.escapeHTML(user.fullname);
        }

        function getAuthorColor(userId) {
            var color = workspace.colorPool[userId];
            return util.formatColor(color);
        }

        function formatMessageText(text) {
            text = util.escapeHtmlWithClickableLinks(text.trim(), "_blank");
            text = text.replace(/\n/g, "<br/>");
            text = emoji.emoji(text, staticPrefix);
            return text;
        }

        function onChatMessage(msg) {
            drawNonPanelElements();
            workspace.addChatMessage(msg);
            if (isOpen()) {
                addMessage(msg);
            }
            else {
                var throbText = "<b>" + getAuthorName(msg.userId) + "</b> ";
                var text = formatMessageText(msg.text);
                var notif = msg.notification;
                if (notif) {
                    throbText += text + " " + notif.linkText;
                } else {
                     throbText += ": " + text;
                }

                chatThrob.innerHTML = throbText;
                chatThrob.style.display = "block";
                clearTimeout(throbTimeout);
                throbTimeout = setTimeout(function () {
                    chatThrob.style.display = "none";
                }, 5000);
            }

            if (msg.increment) {
                var count = Number(chatCounter.innerHTML);
                chatCounter.innerHTML = count + 1;
            }

            var inputFocussed = chatInput && chatInput.ace.isFocused();
            if (!inputFocussed)
                chatNotif.play();
        }

        function addMessage(msg, increment) {
            if (seenMsgs[msg.id])
                return;
            seenMsgs[msg.id] = true;
            //correct the time
            // msg.timestamp += clientTimeOffset;
            var msgDate = new Date(msg.timestamp);

            //create the time string
            var text = formatMessageText(msg.text);
            var authorName = getAuthorName(msg.userId);
            var authorColor = getAuthorColor(msg.userId);

            var authorNameEl = document.createElement("a");
            authorNameEl.href = "javascript:void(0)";
            authorNameEl.className = "authorName";
            authorNameEl.innerHTML = "<b>" + authorName + "</b>";
            // authorNameEl.addEventListener("click", function () {
            // });

            var html = document.createElement("p");

            var borderEl = document.createElement("span");
            html.appendChild(borderEl);
            borderEl.className = "chatBorder";
            borderEl.style.borderLeftColor = authorColor;

            html.appendChild(authorNameEl);
            var textEl = document.createElement("span");
            textEl.className = "chatmessage";
            textEl.innerHTML = text + "<br/>";
            html.appendChild(textEl);
            var timeEl = document.createElement("span");
            timeEl.className = "chattime";
            timeEl.title = msgDate.toISOString();
            timeEl.innerHTML = msgDate;
            timeago(timeEl);
            html.appendChild(timeEl);

            chatText.appendChild(html);
            scrollDown();
        }

        var nonPanelDrawn = false;
        function drawNonPanelElements () {
            if (nonPanelDrawn) return;
            nonPanelDrawn = true;

            ui.insertHtml(null, html, plugin);
            ui.insertCss(css, staticPrefix, plugin);

            function $(id) {
                return document.getElementById(id);
            }

            chatThrob   = $("chatThrob");
            chatCounter = $("chatCounter");
            chatNotif   = $("chatNotif");

            chatThrob.addEventListener("click", function () {
                chatThrob.style.display = "none";
                plugin.show();
            });
        }

        /***** Lifecycle *****/
        plugin.on("load", function(){
            load();
            plugin.once("draw", draw);
        });
        plugin.on("enable", function(){

        });
        plugin.on("disable", function(){
        });

        plugin.on("unload", function(){
            loaded = false;
            drawn  = false;
        });

        /***** Register and define API *****/

        /**
         * Adds File->New File and File->New Folder menu items as well as the
         * commands for opening a new file as well as an API.
         * @singleton
         **/
        plugin.freezePublicAPI({
        });

        register(null, {
            chat: plugin
        });
    }

});