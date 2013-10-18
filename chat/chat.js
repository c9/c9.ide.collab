/*global window apf console*/
define(function(require, exports, module) {
"use strict";

main.consumes = ["Plugin", "c9", "ui", "apf", "collab.util", "collab.workspace", "collab", "jQuery"];
    main.provides = ["chat"];
    return main;

    function main(options, imports, register) {
        var Plugin       = imports.Plugin;
        var c9           = imports.c9;
        var ui           = imports.ui;
        var apf          = imports.apf;
        var util         = imports["collab.util"];
        var workspace    = imports["collab.workspace"];
        var collab       = imports.collab;

        var html         = require("text!./chat.html");
        var css          = require("text!./chat.css");
        var staticPrefix = options.staticPrefix;

        var jQuery       = imports.jQuery.$;

        var plugin = new Plugin("Ajax.org", main.consumes);
        var emit   = plugin.getEmitter();
        // require("./jquery.timeago");
        // var Tinycon = require('../lib/tinycon');
        var emoji = require("./my_emoji");

        var loaded = false;
        function load() {
            if (loaded) return;
            loaded = true;

            collab.on("chatMessage", function (data) {
                addMessage(data, data.increment);
            });

            workspace.on("connect", function() {
                if (!/r/.test(workspace.fs))
                    return console.warn("Don't have read access - You can't use chat");

                draw();
                var chatHistory = workspace.chatHistory;
                jQuery.each(chatHistory, function(i, o) {
                    addMessage(o);
                });
                jQuery("#chatcounter").text(chatHistory.length);
            });

        }

        var drawn = false;
        function draw() {
            if (drawn) return;
            drawn = true;

            ui.insertHtml(null, html, plugin);
            ui.insertCss(css, staticPrefix, plugin);

            var chatInputBox = jQuery("#chatinput");
            chatInputBox.keypress(function(evt) {
                //if the user typed enter, fire the send
                if ((evt.which == 13 || evt.which == 10) &&
                    !evt.shiftKey && !evt.altKey && !evt.ctrlKey && !evt.metaKey) {
                    evt.preventDefault();
                    send();
                }
            });
            chatInputBox.keydown(function(evt) {
                if (evt.which == 27)
                    hide();
            });
            chatInputBox.focus(function() {
                if (typeof apf !== "undefined" && apf.activeElement)
                    apf.activeElement.blur();
            });

            var chatText = jQuery('#chattext');
            autoResizeChatText(chatInputBox.get(0), function (height) {
                // scrollDown(); - flaky scrolling
                chatText.css("bottom", height+12);
            });

            jQuery("#chaticon").click(function () {
                show();
                return false;
            });

            jQuery("#chatmembers").click(function () {
                // Collab.showMembers();
            });

            jQuery("#chatthrob").click(function () {
                jQuery(this).hide();
                show();
            });

            jQuery("#chatcross").click(function () {
                hide();
                return false;
            });
        }

        var seenMsgs = {};
        var throbTimeout;

        function show() {
            jQuery("#chaticon").hide();
            jQuery("#chatbox").show();
            setTimeout(function(){
                jQuery("#chatinput").focus();
            });
            scrollDown();
            // Tinycon.setBubble(0);
            // ide.dispatchEvent("track_action", {type: "chat"});
        }

        function hide() {
            jQuery("#chatcounter").text("0");
            jQuery("#chaticon").show();
            jQuery("#chatbox").hide();
        }

        function scrollDown() {
            if(jQuery('#chatbox').css("display") != "none"){
                if(!self.lastMessage || !self.lastMessage.position() || self.lastMessage.position().top < jQuery('#chattext').height()) {
                    jQuery('#chattext').animate({scrollTop: jQuery('#chattext')[0].scrollHeight}, "fast");
                    self.lastMessage = jQuery('#chattext > p').eq(-1);
                }
            }
        }

        function send() {
            var text = jQuery("#chatinput").val();
            text = emoji.toEmojiUnicode(text);
            collab.send("CHAT_MESSAGE", { text: text });
            jQuery("#chatinput").val("");

            // ide.dispatchEvent("track_action", {type: "chat"});
        }

        function addMessage(msg, increment) {
            if (seenMsgs[msg.id])
                return;
            seenMsgs[msg.id] = true;
            //correct the time
            // msg.timestamp += clientTimeOffset;
            msg.timestamp = new Date(msg.timestamp);

            //create the time string
            var msgDate = new Date(msg.timestamp);
            var text = util.escapeHtmlWithClickableLinks(msg.text.trim(), "_blank");
            text = text.replace(/\n/g, '<br/>');
            text = emoji.emoji(text);

            var user = workspace.users[msg.userId];
            var authorName = util.escapeHTML(user.fullname);
            var color = workspace.colorPool[msg.userId];
            var authorColor = util.formatColor(color);

            var authorNameEl = jQuery("<a href='javascript:void(0)' style='text-decoration: none'><b>" + authorName + "</b></a>").click(function () {
                // Collab.showMembers();
                // Collab.selectMember(msg.userId);
            });

            var chatOpen = jQuery("#chatbox").is(":visible");

            var html;
            var chatThrob = jQuery('#chatthrob');
            var throbText = "";

            var notif = msg.notification;
            if (notif) {
                html = jQuery("<p class='author'>").css("color", "gray")
                    .append(authorNameEl.css("color", "gray"))
                    .append("<span> " + text + "</span>");

                if (notif.linkText) {
                    html.append(jQuery("<a href='javascript:void(0)'>" + notif.linkText + "</a>").click(function() {
                        notif.linkHandler();
                    }));
                    throbText = "<b>" + authorName + "</b> " + text + " " + notif.linkText;
                }

                html.append("<br/>").append(jQuery("<span class='chattime timeago' title='" + msgDate.toISOString() + "'>" + msgDate + "</span> ").timeago());
            }
            else {
                html = jQuery("<p class='author'>")
                    .append(authorNameEl.css("color", "black"))
                    .append("<span style='color:" + authorColor + "'>: " + text + "<br/></span>")
                    .append(jQuery("<span class='chattime timeago' title='" + msgDate.toISOString() + "'>" + msgDate + "</span> ").timeago());
                    throbText = "<b>"+authorName+"</b>" + ": " + text;
            }

            jQuery("#chattext").append(html);

            //should we increment the counter??
            if(increment) {
                var count = Number(jQuery("#chatcounter").text());
                count++;

                // is the users focus already in the chatbox?
                var inputFocussed = jQuery("#chatinput").is(":focus");

                if (!inputFocussed)
                    jQuery("#chat-notif").get(0).play();
                if (!chatOpen) {
                    chatThrob.html(throbText).show();
                    clearTimeout(throbTimeout);
                    throbTimeout = setTimeout(function () {
                        chatThrob.hide(500);
                    }, 5000);
                }

                jQuery("#chatcounter").text(count);
            }
             // Clear the chat mentions when the user clicks on the chat input box
            // jQuery('#chatinput').click(function(){
                // Tinycon.setBubble(0);
            // });
            scrollDown();
        }

        function autoResizeChatText(text, resizeCallback) {
            var observe;
            if (window.attachEvent) {
                observe = function (element, event, handler) {
                    element.attachEvent('on'+event, handler);
                };
            }
            else {
                observe = function (element, event, handler) {
                    element.addEventListener(event, handler, false);
                };
            }

            function resize () {
                text.style.height = 'auto';
                var height = text.scrollHeight || 13;
                text.style.height = height+'px';
                resizeCallback(height);
            }
            /* 0-timeout to get the already changed text */
            function delayedResize () {
                window.setTimeout(resize, 5);
            }
            observe(text, 'change',  delayedResize);
            observe(text, 'cut',     delayedResize);
            observe(text, 'paste',   delayedResize);
            observe(text, 'drop',    delayedResize);
            observe(text, 'keydown', delayedResize);

            text.focus();
            text.select();
            resize();
        }

        /***** Lifecycle *****/
        plugin.on("load", function(){
            load();
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
            show       : show,
            hide       : hide,
            addMessage : addMessage
        });

        register(null, {
            chat: plugin
        });
    }

});