define(function(require, module, exports) {
    main.consumes = [
        "Plugin", "commands", "menus", "ui", "layout", "dialog.alert",
        "MembersPanel", "api", "info"
    ];
    main.provides = ["dialog.share"];
    return main;
    
    function main(options, imports, register) {
        var Plugin       = imports.Plugin;
        var MembersPanel = imports.MembersPanel;
        var commands     = imports.commands;
        var menus        = imports.menus;
        var ui           = imports.ui;
        var alert        = imports["dialog.alert"].show;
        var layout       = imports.layout;
        var api          = imports.api;
        var info         = imports.info;

        var markup   = require("text!./share.xml");
        var css      = require("text!./share.css");

        var plugin   = new Plugin("Ajax.org", main.consumes);
        var emit     = plugin.getEmitter();
        var pid      = info.getWorkspace().pid;

        var dialog, btnInvite, btnDone, txtUsername, shareLink, membersParent;

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
            shareLink       = plugin.getElement("link");
            membersParent   = plugin.getElement("members");

            btnDone.addEventListener("click", hide);
            btnInvite.addEventListener("click", function(){
                var username = txtUsername.value;
                var access = ddAccess.value;
                btnInvite.setAttribute("disabled", true);
                    doInvite(username, access, function(err) {
                        btnInvite.setAttribute("disabled", false);
                        if (err)
                            return alert("Error", "Error adding workspace member", err);
                        hide();
                        alert("Success", "Workspace Member Added", "`" + username + "` granted `" + access.toUpperCase() + "` to the workspace !");
                    });
            });
            
            txtUsername.on("keydown", function(e){
                if (e.keyCode == 13) {
                    console.log("Invite user:", txtUsername.value);
                    e.returnValue = false;
                    return false;
                }
            });

            var membersPanel = new MembersPanel("Ajax.org", main.consumes, {});
            membersPanel.draw({ aml: membersParent });
            membersPanel.show();

            emit("draw", null, true);
        }

        var loaded = false;
        function load() {
            if (loaded) return;
            loaded = true;

            var isWorkspaceAdmin = true; // TODO
            if (!isWorkspaceAdmin)
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
                "skin"    : "c9-menu-btn",
                "class"   : "share",
                "tooltip" : "Share Workspace",
                "width"   : 32,
                "command" : "sharedialog"
            });

            ui.insertByIndex(layout.findParent({
                name: "preferences"
            }), btn, 800, plugin);
        }
        
        /***** Methods *****/

        function doInvite(username, access, callback) {
            api.collab.post("members/add", {
                body: {
                    username : username,
                    access   : access
                }
            }, function (err, data, res) {
                console.log(arguments);
                callback(err);
            });
        }

        function show(){
            draw();
            dialog.show();
        }

        function hide() {
            dialog && dialog.hide();
        }

        plugin.on("load", function(){
            load();
        });
        
        /***** Register *****/
        register("", {
            "dialog.share": plugin
        });
    }
});