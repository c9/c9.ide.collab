define(function(require, exports, module) {
"use strict";

    main.consumes = [
        "Plugin", "ui", "apf", "Menu", "MenuItem",
        "collab.workspace", "api", "info", "dialog.alert", "dialog.confirm"
    ];
    main.provides = ["MembersPanel"];
    return main;

    function main(options, imports, register) {
        var Plugin       = imports.Plugin;
        var apf          = imports.apf;
        var Menu         = imports.Menu;
        var MenuItem     = imports.MenuItem;
        var workspace    = imports["collab.workspace"];
        var api          = imports.api;
        var info         = imports.info;
        var alert        = imports["dialog.alert"].show;
        var confirm      = imports["dialog.confirm"].show;

        var Tree         = require("ace_tree/tree");
        var TreeData     = require("./membersdp");

        var ROLE_ADMIN        = "a";

        function MembersPanel(developer, deps, options){
            // Editor extends ext.Plugin
            var plugin = new Plugin(developer, deps);
            // var emit   = plugin.getEmitter();

            var membersTree, membersDataProvider;

            var drawn = false;
            function draw(options) {
                if (drawn) return;
                drawn = true;

                var parent = options.aml;

                // Members panel
                membersTree         = new Tree(parent.$int);
                membersDataProvider = new TreeData();
                membersTree.renderer.setTheme({cssClass: "memberstree"});
                membersTree.renderer.setScrollMargin(0, 10);
                // Assign the dataprovider
                membersTree.setDataProvider(membersDataProvider);

                membersTree.on("mousedown", function(e){
                    var domTarget = e.domEvent.target;

                    var pos = e.getDocumentPosition();
                    var node = membersDataProvider.findItemAtOffset(pos.y);
                    if (!node || !domTarget)
                        return;

                    var className = domTarget.classList;
                    membersDataProvider.selection.selectNode(node);
                    if (className.contains("access_control"))
                        updateAccess(className.contains("rw") ? "r" : "rw");
                    else if (className == "kickout")
                        removeMember();
                });

                var mnuCtxTree = new Menu({
                    id : "mnuMembers",
                    items: [
                        new MenuItem({
                            caption : "Grant Read+Write Access",
                            match   : "r",
                            onclick : updateAccess.bind(null, "rw")
                        }),
                        new MenuItem({
                            caption : "Revoke Write Access",
                            match   : "rw",
                            onclick : updateAccess.bind(null, "r")
                        }),
                        new MenuItem({
                            caption : "Kick Out",
                            onclick : removeMember
                        })
                    ]
                }, plugin);

                var mnuCtxTreeEl = mnuCtxTree.aml;

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
                parent.setAttribute("contextmenu", mnuCtxTreeEl);
                window.addEventListener('resize', resize, true);
            }

            function hide() {
                workspace.off("sync", onMembersLoaded);
            }

            function show() {
                loadMembers();
                onMembersLoaded();
                workspace.off("sync", onMembersLoaded);
                workspace.on("sync", onMembersLoaded);
            }

            function refresh() {
                loadMembers();
            }

            function resize() {
                membersTree.resize();
            }

            var cachedMembers = [];
            function loadMembers() {
                api.collab.get("members/list?pending=0", function (err, members) {
                    if (err) return alert("Error", err);

                    cachedMembers = members;
                    onMembersLoaded();
                });
            }

            function updateAccess(acl) {
                var node = getSelectedMember();
                var uid = node.uid;
                api.collab.put("members/update_access", {
                    body: {
                        uid    : uid,
                        access : acl
                    }
                }, function (err, data, res) {
                    if (err) return alert(err);

                    (cachedMembers.filter(function (member) {
                        return member.uid  == uid;
                    })[0] || {}).acl = acl;
                    onMembersLoaded();
                });
            }

            function removeMember() {
                var node = getSelectedMember();
                confirm(
                    "Kickout Member?",
                    "Are you sure you want to kick '" + node.name
                        + "' out of your workspace '" + info.getWorkspace().name + "' ?",
                    "By kicking out a member of a workspace, (s)he can no longer "
                        + "read, write nor collaborate on that workspace ",
                    function(){ // Yes
                        var uid = node.uid;
                        api.collab.delete("members/remove", {
                            body: { uid : uid }
                        }, function (err, data, res) {
                            if (err) return alert(err);

                            cachedMembers = cachedMembers.filter(function (member) {
                                return member.uid  != uid;
                            });
                            onMembersLoaded();
                        });
                    }, function(){ /* No */ }
                );
            }

            function getSelectedMember() {
                return membersTree.selection.getCursor();
            }

            function onMembersLoaded() {
                var me = info.getUser();
                var members = {r: [], rw: []};
                var myRow = {};

                if (!Array.isArray(cachedMembers)) {
                    // standalone version test
                    cachedMembers = [
                        { name: "Mostafa Eweda", uid: 1, acl: "rw", role: "a", email: "mostafa@c9.io" },
                        { name: "Lennart Kats", uid: 5, acl: "r", color: "yellow", status: "online", email: "lennart@c9.io" },
                        { name: "Ruben Daniels", uid: 2, acl: "rw", color: "blue", status: "idle", email: "ruben@ajax.org" },
                        { name: "Bas de Wachter", uid: 8, acl: "rw", color: "purple", email: "bas@c9.io" }
                    ];
                }

                cachedMembers.forEach(function (m) {
                    m.isAdmin = m.role == ROLE_ADMIN;
                    m.color = m.color || workspace.getUserColor(m.uid);
                    // TODO support idle state
                    m.status = m.status || (workspace.isUserOnline(m.uid) ? "online" : "offline");
                    m.md5Email = m.email ? apf.crypto.MD5.hex_md5(m.email.trim().toLowerCase()) : "";
                    members[m.acl].push(m);

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

                if (!members.r.length)
                    membersDataProvider.setRoot(members.rw);
                else
                    membersDataProvider.setRoot([
                        {
                            name: "Read+Write",
                            items: members.rw
                        },
                        {
                            name: "Read Only",
                            items: members.r
                        }
                    ]);
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
                draw  : draw,
                /**
                 * Trigger a resize of the members tree
                 */
                resize  : resize,
                /**
                 * Load workspace members, render the tree and set update listeners
                 */
                show    : show,
                /**
                 * Refresh workspace members list
                 */
                refresh : refresh,
                /**
                 * Hide the members tree and unset update listeners
                 */
                hide    : hide
            });

            return plugin;
        }

        register(null, {
            MembersPanel: MembersPanel
        });
    }
});
