define(function(require, module, exports) {
    main.consumes = [
        "Plugin", "c9", "commands", "menus", "ui", "layout", "dialog.alert",
        "MembersPanel", "info", "collab.workspace", "Menu", "MenuItem",
        "clipboard", "settings", "api"
    ];
    main.provides = ["dialog.share"];
    return main;

    function main(options, imports, register) {
        var Plugin = imports.Plugin;
        var c9 = imports.c9;
        var MembersPanel = imports.MembersPanel;
        var commands = imports.commands;
        var settings = imports.settings;
        var menus = imports.menus;
        var clipboard = imports.clipboard;
        var ui = imports.ui;
        var api = imports.api;
        var alert = imports["dialog.alert"].show;
        var layout = imports.layout;
        var workspace = imports["collab.workspace"];
        var Menu = imports.Menu;
        var MenuItem = imports.MenuItem;

        var markup = require("text!./share.xml");
        var css = require("text!./share.css");

        var plugin = new Plugin("Ajax.org", main.consumes);
        var emit = plugin.getEmitter();

        var dialog, btnInvite, btnDone, txtUsername, membersParent, accessButton;
        var membersPanel, shareLinkEditor, shareLinkApp, shareLinkPreview;
        var publicApp, publicPreview, publicEditor;

        var loaded = false;
        function load() {
            if (loaded) return;
            loaded = true;

            if (!c9.isAdmin)
                return;

            commands.addCommand({
                name: "sharedialog",
                hint: "Share the workspace",
                group: "General",
                exec: show
            }, plugin);

            var btn = new ui.button({
                "skin"    : "c9-menu-btn",
                "caption" : "Share",
                // "class"   : "share",
                "tooltip" : "Share this workspace",
                // "width"   : 80,
                "command" : "sharedialog"
            });
            
            menus.addItemByPath("Window/~", new ui.divider(), 35, plugin);
            menus.addItemByPath("Window/Share...", new ui.item({
                command: "sharedialog"
            }), 36, plugin);

            ui.insertByIndex(layout.findParent({
                name: "preferences"
            }), btn, 600, plugin);
            
            settings.on("read", function(){
                settings.setDefaults("project/share", [
                    ["preview", false],
                    ["app", false]
                ]);
            });
        }

        var drawn = false;
        function draw(){
            if (drawn) return;
            drawn = true;

            ui.insertCss(css, plugin);
            ui.insertMarkup(null, markup, plugin);
            
            commands.addCommand({
                name: plugin.name,
                bindKey: { mac: "ESC", win: "ESC" },
                group: "ignore",
                isAvailable: function(){
                    return dialog.visible;
                },
                exec: function(){
                    dialog.dispatchEvent("keydown", { keyCode : 27 });
                }
            }, plugin);

            dialog = plugin.getElement("window");
            btnInvite = plugin.getElement("btnInvite");
            btnDone = plugin.getElement("btnDone");
            txtUsername = plugin.getElement("txtUsername");
            shareLinkEditor = plugin.getElement("shareLinkEditor").$int;
            shareLinkApp = plugin.getElement("shareLinkApp").$int;
            shareLinkPreview = plugin.getElement("shareLinkPreview").$int;
            membersParent = plugin.getElement("members");
            publicApp = plugin.getElement("publicApp");
            publicPreview = plugin.getElement("publicPreview");
            publicEditor = plugin.getElement("publicEditor");
            accessButton = plugin.getElement("access").$int;

            var mnuLink = new Menu({
                items: [
                    new MenuItem({ caption: "Open", onclick: function(){
                        window.open(mnuLink.meta.linkText);
                    }}),
                    new MenuItem({ caption: "Copy", onclick: function(){
                        clipboard.copy(false, mnuLink.meta.linkText);
                    }})
                ]
            }, plugin);

            var port = (options.local ? ":" + (c9.port || "8080") : "");
            if (!options.local) {
                var l = location;
                shareLinkEditor.innerHTML = l.protocol + "//" + l.host + l.pathname;
            }
            else {
                shareLinkEditor.innerHTML = "https://ide.c9.io/" + c9.workspaceId;
            }
            
            shareLinkApp.innerHTML = (c9.hostname 
                ? "https://" + c9.hostname
                : "http://localhost") + port;
            shareLinkPreview.innerHTML = options.previewUrl;
            
            [shareLinkEditor, shareLinkApp, shareLinkPreview].forEach(function(div){
                div.addEventListener("click", function(e){
                    mnuLink.meta.linkText = this.innerHTML;
                    mnuLink.show(e.x, e.y);
                });
            });

            accessButton.addEventListener("click", function () {
                var className = accessButton.classList;
                var actionArr = className.contains("rw") ? ["rw", "r"] : ["r", "rw"];
                className.remove(actionArr[0]);
                className.add(actionArr[1]);
            });
            
            function updateAccess(field, value, cb){
                cb.disable();
                api.project.put("access/" + field + "/" + (value ? "public" : "private"), function(err){
                    if (err) {
                        cb.enable();
                        cb[value ? "uncheck" : "check"]();
                        
                        // Forbidden
                        if (err.code == 401) {
                            alert("Forbidden",
                                "You are not allowed to change this setting.",
                                "Only the owner of this workspace can change "
                                  + "this setting. Please contact the owner "
                                  + "about this.");
                        }
                        // Payment Required
                        else if (err.code == 402) {
                            alert("Maximum Private Workspaces Reached",
                                "It seems you have reached the maximum number "
                                  + "of workspaces under your account",
                                "Please go to the dashboard or contact support "
                                  + "to increase the number of private workspaces.");
                        }
                        // Other Errors
                        else {
                            alert("Failed updating public status",
                                "The server returned an error",
                                "Please try again later.");
                        }
                    }
                });
            }
            
            publicEditor.on("afterchange", function(e){
                updateAccess("visibility", e.value, publicEditor);
            });
            publicApp.on("afterchange", function(e){
                updateAccess("app", e.value, publicApp);
            });
            publicPreview.on("afterchange", function(e){
                updateAccess("preview", e.value, publicPreview);
            });
            
            btnDone.on("click", hide);
            btnInvite.on("click", inviteUser);

            txtUsername.on("keydown", function(e) {
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
            
            api.collab.get("access_info", function (err, info) {
                if (err) return;
                
                publicEditor[info.private ? "uncheck" : "check"]();
                publicApp[!info.publicApp ? "uncheck" : "check"]();
                publicPreview[!info.publicPreview ? "uncheck" : "check"]();
            });

            emit.sticky("draw");
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
                    return alert("Error", "Error adding workspace member", err.message);
                alert("Invitation Sent",
                    "Workspace Member Added",
                    "You have granted " + member.name + " " + accessString
                        + "access to this workspace!");
            });
        }

        function show(){
            draw();
            dialog.show();
            membersPanel.show();
            txtUsername.setValue("");
            txtUsername.blur();
            // shareLink.focus();
            // shareLink.select();
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