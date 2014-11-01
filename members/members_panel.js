define(function(require, exports, module) {
"use strict";

    main.consumes = [
        "Plugin", "ui", "util", "apf", "Menu", "MenuItem",
        "collab.workspace", "info", "dialog.error", "dialog.confirm",
        "accessControl"
    ];
    main.provides = ["MembersPanel"];
    return main;

    function main(options, imports, register) {
        var Plugin = imports.Plugin;
        var c9Util = imports.util;
        var apf = imports.apf;
        var Menu = imports.Menu;
        var MenuItem = imports.MenuItem;
        var workspace = imports["collab.workspace"];
        var info = imports.info;
        var showError = imports["dialog.error"].show;
        var confirm = imports["dialog.confirm"].show;
        var accessControl = imports.accessControl;
        
        var cloneObject = c9Util.cloneObject;
        var Tree = require("ace_tree/tree");
        var TreeData = require("./membersdp");
        var mnuCtxTreeEl;
        var mnuCtxTreePublicEl;

        var ROLE_ADMIN = "a";

        function MembersPanel(developer, deps, options) {
            // Editor extends ext.Plugin
            var plugin = new Plugin(developer, deps);
            // var emit = plugin.getEmitter();

            var membersTree, membersDataProvider, parent;

            var drawn = false;
            function draw(options) {
                if (drawn) return;
                drawn = true;

                parent = options.aml;

                // Members panel
                membersTree = new Tree(parent.$int);
                membersDataProvider = new TreeData();
                membersTree.renderer.setTheme({cssClass: "memberstree"});
                membersTree.renderer.setScrollMargin(0, 10);
                // Assign the dataprovider
                membersTree.setDataProvider(membersDataProvider);

                membersTree.on("mousedown", function(e) {
                    var domTarget = e.domEvent.target;

                    var pos = e.getDocumentPosition();
                    var node = membersDataProvider.findItemAtOffset(pos.y);
                    if (!node || !domTarget)
                        return;

                    var className = domTarget.classList;
                    membersDataProvider.selection.selectNode(node);
                    if (className.contains("access_control")) {
                        if (className.contains("rw")) {
                            className.remove("rw");
                            className.add("r");
                        }
                        else {
                            className.remove("r");
                            className.add("rw");
                        }
                        membersTree.resize(true);
                    }
                });
                membersTree.on("mouseup", function(e) {
                    var domTarget = e.domEvent.target;

                    var pos = e.getDocumentPosition();
                    var node = membersDataProvider.findItemAtOffset(pos.y);
                    if (!node || !domTarget)
                        return;

                    var className = domTarget.classList;
                    membersDataProvider.selection.selectNode(node);
                    if (className.contains("access_control"))
                        updateAccess(node.acl == "rw" ? "r" : "rw");
                    else if (className == "kickout")
                        removeMember();
                });

                var mnuCtxTree = new Menu({
                    id: "mnuMembers",
                    items: [
                        new MenuItem({
                            caption: "Grant Read+Write Access",
                            match: "r",
                            onclick: updateAccess.bind(null, "rw")
                        }),
                        new MenuItem({
                            caption: "Revoke Write Access",
                            match: "rw",
                            onclick: updateAccess.bind(null, "r")
                        }),
                        new MenuItem({
                            caption: "Kick Out",
                            onclick: removeMember
                        })
                    ]
                }, plugin);

                var mnuCtxTreePublic = new Menu({
                    id: "mnuMembers",
                    items: [
                        new MenuItem({
                            caption: "Request Read+Write Access",
                            match: "r",
                            onclick: accessControl.requestAccess
                        })
                    ]
                }, plugin);

                mnuCtxTreeEl = mnuCtxTree.aml;
                mnuCtxTreePublicEl = mnuCtxTreePublic.aml;

                mnuCtxTree.on("show", function() {
                    var node = getSelectedMember() || {};
                    if (!node.uid)
                        return mnuCtxTreeEl.hide();
                    mnuCtxTreeEl.childNodes.forEach(function(item) {
                        var match = item.match;
                        var disabled = false;
                        if (node.isAdmin || (match && match !== node.acl))
                            disabled = true;
                        item.setAttribute("disabled", disabled);
                    });
                });
                if (workspace.accessInfo.member)
                    parent.setAttribute("contextmenu", mnuCtxTreeEl);
                else
                    parent.setAttribute("contextmenu", mnuCtxTreePublicEl);
                
                window.addEventListener('resize', resize, true);
                
                membersTree.container.style.position = "relative";
                membersTree.container.style.top = "0px";
            }
            
            function hide() {
                workspace.off("sync", onWorkspaceSync);
            }
            
            function alertIfError(err) {
               err && showError("Error", "Members Panel Error", err.message);
            }

            function show() {
                workspace.loadMembers(alertIfError);
                workspace.off("sync", onWorkspaceSync);
                workspace.on("sync", onWorkspaceSync);
                setTimeout(resize);
            }

            function resize() {
                var rowHeight = membersTree.provider.rowHeight;
                var maxLines = Math.floor(
                    Math.max(window.innerHeight / 2 - 60, 60) / rowHeight
                );
                membersTree.renderer.setOption("maxLines", maxLines);
                membersTree.resize();
            }

            function updateAccess(acl) {
                var node = getSelectedMember();
                var uid = node.uid;
                workspace.updateAccess(uid, acl, alertIfError);
            }

            function removeMember() {
                var node = getSelectedMember();
                confirm(
                    "Kickout Member?",
                    "Are you sure you want to kick '" + node.name
                        + "' out of your workspace '" + info.getWorkspace().name + "'?",
                    "By kicking out a member of a workspace, they can no longer "
                        + "read, write or collaborate on that workspace ",
                    function(){ // Yes
                        var uid = node.uid;
                        workspace.removeMember(uid, alertIfError);
                    }, function(){ /* No */ }
                );
            }

            function getSelectedMember() {
                return membersTree.selection.getCursor();
            }

            function onWorkspaceSync() {
                var me = info.getUser();
                var members = {r: [], rw: []};
                var myRow = {};

                var cachedMembers = workspace.members;
                var users = workspace.users;
                
                if (!cachedMembers.length) { // We're visiting a public workspace
                    cachedMembers = [{
                        acl: "r",
                        name: "You",
                        pending: false,
                        role: "v",
                        uid: me.id,
                        email: me.email
                    }];
                }
                
                cachedMembers.forEach(function (m) {
                    m = cloneObject(m);
                    m.isAdmin = m.role == ROLE_ADMIN;
                    m.color = m.color || workspace.getUserColor(m.uid);
                    m.status = m.onlineStatus || workspace.getUserState(m.uid);
                    m.md5Email = m.email ? apf.crypto.MD5.hex_md5(m.email.trim().toLowerCase()) : "";
                    members[m.acl == "rw" ? "rw" : "r"].push(m);
                    
                    var childList = users[m.uid] && users[m.uid].clients;
                    m.items = childList && childList.length > 1 && childList.map(function(k, i) {
                        return {
                            id: k,
                            name: "Tab " + i,
                            user: m
                        };
                    });

                    if (m.uid == me.id) {
                        m.name = "0000"; // top in every sory
                        m.status = "online";
                        myRow = m;
                        // m.status = "online";
                        membersDataProvider.iAmAdmin = m.isAdmin;
                    }
                });

                function memberCompartor (m1, m2) {
                    return m1.name > m2.name;
                }

                members.r.sort(memberCompartor);
                members.rw.sort(memberCompartor);
                myRow.name = "You";

                membersDataProvider.setRoot([{
                    name: "Read+Write",
                    items: members.rw,
                    noSelect: true,
                    clickAction: "toggle",
                    className: "caption"
                }, {
                    name: "Read Only",
                    items: members.r,
                    noSelect: true,
                    clickAction: "toggle",
                    className: "caption"
                }].filter(function(x) {
                    return x.items.length;
                }));
                
                if (workspace.accessInfo.member)
                    parent.setAttribute("contextmenu", mnuCtxTreeEl);
                else
                    parent.setAttribute("contextmenu", mnuCtxTreePublicEl);
            }

             /***** Register and define API *****/

            plugin.freezePublicAPI.baseclass();

            /**
             * Members panel base class for the {@link members}.
             *
             * A members panel is a section of the collab that shows the members of a workspace
             * with thier access rights, collaborator colors
             *
             * @class MembersPanel
             * @extends Plugin
             */
            /**
             * @constructor
             * Creates a new MembersPanel instance.
             * @param {String}   developer   The name of the developer of the plugin
             * @param {String[]} deps        A list of dependencies for this
             *   plugin. In most cases it's a reference to `main.consumes`.
             * @param {Object}   options     The options for the members panel
             */
            plugin.freezePublicAPI({
                /**
                 * Draw the members panel on a parent element
                 * 
                 * @param {AMLElement} options.aml
                 */
                draw: draw,
                /**
                 * Trigger a resize of the members tree
                 */
                resize: resize,
                /**
                 * Load workspace members, render the tree and set update listeners
                 */
                show: show,
                /**
                 * Hide the members tree and unset update listeners
                 */
                hide: hide
            });

            return plugin;
        }

        register(null, {
            MembersPanel: MembersPanel
        });
    }
});
