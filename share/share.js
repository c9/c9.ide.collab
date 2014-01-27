define(function(require, module, exports) {
    main.consumes = [
        "Plugin", "c9", "commands", "menus", "ui", "layout", "dialog.alert",
        "MembersPanel", "info", "collab.workspace",
    ];
    main.provides = ["dialog.share"];
    return main;

    function main(options, imports, register) {
        var Plugin       = imports.Plugin;
        var c9           = imports.c9;
        var MembersPanel = imports.MembersPanel;
        var commands     = imports.commands;
        var menus        = imports.menus;
        var ui           = imports.ui;
        var alert        = imports["dialog.alert"].show;
        var layout       = imports.layout;
        var workspace    = imports["collab.workspace"];

        var markup   = require("text!./share.xml");
        var css      = require("text!./share.css");

        var plugin   = new Plugin("Ajax.org", main.consumes);
        var emit     = plugin.getEmitter();

        var dialog, btnInvite, btnDone, txtUsername, shareLink, membersParent, accessButton;
        var membersPanel;

        var loaded = false;
        function load() {
            if (loaded) return;
            loaded = true;

            if (!c9.isAdmin)
                return;

            commands.addCommand({
                name    : "sharedialog",
                hint    : "Share the workspace",
                group   : "General",
                exec    : show
            }, plugin);

            menus.addItemByPath("Window/Share Workspace", new ui.item({
                command: "sharedialog"
            }), 20100, plugin);

            var btn =  new ui.button({
                "skin"    : "btn-default-css3",
                "class"   : "btn-green",
                "caption" : "Share",
                "tooltip" : "Share Workspace",
                "width"   : 80,
                "command" : "sharedialog"
            });

            ui.insertByIndex(layout.findParent({
                name: "preferences"
            }), btn, 800, plugin);
        }

        var drawn = false;
        function draw(){
            if (drawn) return;
            drawn = true;

            ui.insertCss(css, plugin);
            ui.insertMarkup(null, markup, plugin);

            dialog          = plugin.getElement("window");
            btnInvite       = plugin.getElement("btnInvite");
            btnDone         = plugin.getElement("btnDone");
            txtUsername     = plugin.getElement("txtUsername");
            shareLink       = plugin.getElement("shareLink").$int;
            membersParent   = plugin.getElement("members");
            accessButton    = plugin.getElement("access").$int;

            shareLink.value = getShareUrl();
            accessButton.addEventListener("click", function () {
                var className = accessButton.classList;
                var actionArr = className.contains("rw") ? ["rw", "r"] : ["r", "rw"];
                className.remove(actionArr[0]);
                className.add(actionArr[1]);
            });

            btnDone.addEventListener("click", hide);
            btnInvite.addEventListener("click", inviteUser);

            txtUsername.on("keydown", function(e){
                if (e.keyCode == 13) {
                    inviteUser();
                    e.returnValue = false;
                    return false;
                }
                else if (e.keyCode === 27) {
                    hide();
                }
            });

            membersPanel = new MembersPanel("Ajax.org", main.consumes, {});
            membersPanel.draw({ aml: membersParent });

            emit("draw", null, true);
        }

        /***** Methods *****/

        function inviteUser(){
            var username = txtUsername.value;
            var access = accessButton.classList.contains("rw") ? "rw" : "r";
            var accessString = access === "rw" ? "Read+Write" : "Read-Only";
            btnInvite.setAttribute("disabled", true);
            workspace.addMember(username, access, function(err, member) {
                btnInvite.setAttribute("disabled", false);
                txtUsername.setValue("");
                if (err)
                    return alert("Error", "Error adding workspace member", String(err));
                alert("Invitation Sent", 
                    "Workspace Member Added", 
                    "You have granted " + member.name + " " + accessString 
                        + "access to this workspace!");
            });
        }

        function getShareUrl() {
            var l = location;
            return l.protocol + "//" + l.host + l.pathname;
        }

        function show(){
            draw();
            dialog.show();
            membersPanel.show();
            txtUsername.setValue("");
            txtUsername.blur();
            shareLink.focus();
            shareLink.select();
        }

        function hide() {
            dialog && dialog.hide();
        }

        plugin.on("load", function(){
            load();
        });

        /***** Register and define API *****/

        /**
         * The Share dialog - allowing users to share the workspace with other cloud9 users
         * @singleton
         */
        plugin.freezePublicAPI({
        });

        register(null, {
            "dialog.share": plugin
        });
    }
});