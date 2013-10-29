/*global window apf console*/
define(function(require, exports, module) {
"use strict";

main.consumes = ["Panel", "panels", "c9", "ui", "apf", "collab.util", "collab.workspace", "collab"];
    main.provides = ["chat"];
    return main;

    function main(options, imports, register) {
        var Panel        = imports.Panel;
        var panels       = imports.panels;
        var c9           = imports.c9;
        var ui           = imports.ui;
        var apf          = imports.apf;
        var util         = imports["collab.util"];
        var workspace    = imports["collab.workspace"];
        var collab       = imports.collab;

        var html         = require("text!./chat.html");
        var markup       = require("text!./chat.xml");
        var css          = require("text!./chat.css");
        var timeago      = require("./timeago");
        var staticPrefix = options.staticPrefix;

        var plugin = new Panel("Ajax.org", main.consumes, {
            index        : 25,
            width        : 250,
            caption      : "Chat",
            elementName  : "winChat",
            minWidth     : 130,
            where        : "right",
            autohide     : true
        });

        var emit   = plugin.getEmitter();
        var emoji = require("./my_emoji");

        // panel-relared UI elements
        var winChat, chatInput, chatText;
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

            ui.insertMarkup(options.aml, markup, plugin);

            winChat     = plugin.getElement("winChat");
            chatInput   = plugin.getElement("chatInput");
            chatText    = plugin.getElement("chatText").$ext;

            function onWorkspaceConnect() {
                if (!/r/.test(workspace.fs))
                    return console.warn("Don't have read access - You can't use chat");
                var chatHistory = workspace.chatHistory;
                chatHistory.forEach(function(msg){
                    addMessage(msg, msg.increment);
                });
                scrollDown();
                chatCounter.innerHTML = chatHistory.length;
            }

            plugin.on("show", function(e){
                chatInput.focus();
                workspace.on("connect", onWorkspaceConnect);
            });
            plugin.on("hide", function(e){
                workspace.off("connect", onWorkspaceConnect);
            });

            chatInput.ace.setOption("wrap", "free");
            chatInput.ace.commands.addCommands([
                {
                    bindKey : "ESC",
                    exec    : function(){
                        if (chatInput.getValue())
                            chatInput.setValue("");
                        else
                            plugin.hide();
                    }
                }, {
                    bindKey : "Enter",
                    exec    : send
                }
            ]);
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
            return panels.isActive("chat");
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
            text = emoji.emoji(text);
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

            var notif = msg.notification;
            if (notif) {
                html.appendChild(authorNameEl);
                html.appendChild(document.createTextNode(" " + text));

                if (notif.linkText) {
                    var link = document.createElement("a");
                    link.href = "javascript:void(0)";
                    link.innerText = notif.linkText;
                    link.addEventListener("click", function() {
                        notif.linkHandler();
                    });
                    html.appendChild(link);
                }
            }
            else {
                authorNameEl.innerHTML += ": ";
                html.appendChild(authorNameEl);
                var textEl = document.createElement("span");
                textEl.style.color = authorColor;
                textEl.innerHTML = text + "<br/>";
                html.appendChild(textEl);
                var timeEl = document.createElement("span");
                timeEl.className = "chattime";
                timeEl.title = msgDate.toISOString();
                timeEl.innerHTML = msgDate;
                timeago(timeEl);
                html.appendChild(timeEl);
            }

            chatText.appendChild(html);
            scrollDown();
        }

        var nonPanelDrawn = false;
        function drawNonPanelElements (argument) {
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
        });
        plugin.on("draw", function(e){
            draw(e);
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