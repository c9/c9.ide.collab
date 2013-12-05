/*global window console*/
define(function(require, exports, module) {
"use strict";

    main.consumes = [
        "Plugin", "ui", "apf", "Menu", "MenuItem",
        "collab.workspace", "api", "info", "dialog.alert"
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
        
        var Tree         = require("ace_tree/tree");
        var TreeData     = require("./membersdp");

        var ROLE_NONE         = "n";
        var ROLE_VISITOR      = "v";
        var ROLE_COLLABORATOR = "c";
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
    
                // APF + DOM HACK: popup menu
                membersTree.on("mousedown", function(e){
                    var domTarget = e.domEvent.target;
    
                    var pos = e.getDocumentPosition();
                    var node = membersDataProvider.findItemAtOffset(pos.y);
                    if (!node || !domTarget || domTarget.className.indexOf("access") !== 0)
                        return;
    
                    membersDataProvider.selection.selectNode(node);
                    membersDataProvider._signal("change");
                    var parentPos = apf.getAbsolutePosition(parent.$int);
                    var left = parentPos[0] + 20;
                    var top = e.y + 10;
                    mnuCtxTreeEl.display(left, top, null, parent);
                    setTimeout(function () {
                        mnuCtxTreeEl.show();
                    }, 10);
                });
    
                var mnuCtxTree = new Menu({
                    id : "mnuMembers",
                    items: [
                        new MenuItem({
                            caption : "Grant Read+Write Access",
                            match   : "r",
                            onclick : updateMember.bind(null, "rw")
                        }),
                        new MenuItem({
                            caption : "Revoke Write Access",
                            match   : "rw",
                            onclick : updateMember.bind(null, "r")
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

            function hide () {
                workspace.off("sync", onMembersLoaded);
            }
            
            function show() {
                loadMembers();
                onMembersLoaded();
                workspace.on("sync", onMembersLoaded);
            }
            
            function resize() {
                membersTree.resize();
            }
    
            var cachedMembers = [];
            function loadMembers() {
                api.collab.get("members/list", function (err, members) {
                    if (err) return alert(err);
    
                    cachedMembers = members;
                    onMembersLoaded();
                });
            }
    
            function updateMember(acl) {
                var node = getSelectedMember();
                var uid = node.uid;
                api.collab.put("members/update", {
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
            }
    
            function getSelectedMember() {
                return membersTree.selection.getCursor();
            }
    
            function onMembersLoaded() {
                var me = info.getUser();
                var members = {r: [], rw: []};
                var myRow = {};
    
                if (!cachedMembers.length || !Array.isArray(cachedMembers)) {
                    // standalone version test
                    cachedMembers = [
                        { name: "Mostafa Eweda", uid: 1, acl: "rw", role: "a", email: "mostafa@c9.io" },
                        { name: "Lennart Kats", uid: 5, acl: "r", color: "yellow", status: "online", email: "lennart@c9.io" },
                        { name: "Ruben Daniels", uid: 2, acl: "rw", color: "blue", status: "idle", email: "ruben@ajax.org" },
                        { name: "Fabian Jakobs", uid: 4, acl: "rw", color: "green", status: "online", email: "fabian@ajax.org" },
                        { name: "Jos Uijterwaal", uid: 7, acl: "rw", color: "red", status: "idle", email: "jos@ajax.org" },
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
             * Collab panel base class for the {@link collab}.
             *
             * A collab panel is a section of the collab that allows users to
             * collaborate on a workspace
             *
             * @class CollabPanel
             * @extends Plugin
             */
            /**
             * @constructor
             * Creates a new CollabPanel instance.
             * @param {String}   developer   The name of the developer of the plugin
             * @param {String[]} deps        A list of dependencies for this
             *   plugin. In most cases it's a reference to `main.consumes`.
             * @param {Object}   options     The options for the collab panel
             * @param {String}   options.caption  The caption of the frame.
             */
            plugin.freezePublicAPI({
                draw : draw,
                resize: resize,
                show: show,
                hide: hide
            });

            return plugin;
        }
        
        register(null, {
            MembersPanel: MembersPanel
        });
    }
});
