/*global window apf console*/
define(function(require, exports, module) {
"use strict";

main.consumes = ["CollabPanel", "ui", "apf", "menus", "Menu", "MenuItem",
        "collab", "collab.workspace", "api", "info", "dialog.alert"];
    main.provides = ["members"];
    return main;

    function main(options, imports, register) {
        var CollabPanel  = imports.CollabPanel;
        var ui           = imports.ui;
        var apf          = imports.apf;
        var menus        = imports.menus;
        var Menu         = imports.Menu;
        var MenuItem     = imports.MenuItem;
        var workspace    = imports["collab.workspace"];
        var collab       = imports.collab;
        var api          = imports.api;
        var info         = imports.info;
        var alert        = imports["dialog.alert"].show;

        var css          = require("text!./members.css");
        var staticPrefix = options.staticPrefix;

        var Tree         = require("ace_tree/tree");
        var TreeData     = require("./membersdp");

        var ROLE_NONE = "n";
        var ROLE_VISITOR = "v";
        var ROLE_COLLABORATOR = "c";
        var ROLE_ADMIN = "a";

        var plugin = new CollabPanel("Ajax.org", main.consumes, {
            index        : 100,
            caption      : "Workspace Members"
        });

        var emit   = plugin.getEmitter();

        var membersParent, membersTree, membersDataProvider;

        var loaded = false;
        function load() {
            if (loaded) return;
            loaded = true;

        }

        var drawn = false;
        function draw(options) {
            if (drawn) return;
            drawn = true;

            ui.insertCss(css, staticPrefix, plugin);

            var parent = options.aml;
            
            membersParent = parent.appendChild(new ui.bar({
                border: "0",
                margin: "0 0 0 0",
                flex  : "1"
            }));
            plugin.addElement(membersParent);

            // Members panel
            membersTree = new Tree(membersParent.$int);
            membersDataProvider = new TreeData();
            membersTree.renderer.setScrollMargin(0, 10);
            membersTree.renderer.setTheme({cssClass: "memberstree"});
            membersTree.setOption("maxLines", 10);
            membersTree.setOption("minLines", 2);
            // Assign the dataprovider
            membersTree.setDataProvider(membersDataProvider);
            // Some global render metadata
            membersDataProvider.staticPrefix = staticPrefix;

            // APF + DOM HACK: popup menu
            membersTree.on("mousedown", function(e){
                var domTarget = e.domEvent.target;

                var pos = e.getDocumentPosition();
                var node = membersDataProvider.findItemAtOffset(pos.y);
                if (!node || !domTarget || domTarget.className.indexOf("access") !== 0)
                    return;

                membersDataProvider.selection.selectNode(node);
                membersDataProvider._signal("change");
                var parentPos = apf.getAbsolutePosition(membersParent.$int);
                var left = parentPos[0] + 20;
                var top = e.y + 10;
                mnuCtxTreeEl.display(left, top, null, membersParent);
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
            membersParent.setAttribute("contextmenu", mnuCtxTreeEl);

            collab.on("show", function(){
                loadMembers();
                onMembersLoaded();
                workspace.on("sync", onMembersLoaded);
            });

            collab.on("hide", function(){
                workspace.off("sync", onMembersLoaded);
            });
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
            // cachedMembers =  [{ name: "ME", uid: 5, acl: "rw", role: "a" }, { name: "ABC", uid: 1, acl: "r" }, { name: "DEF", uid: 2, acl: "rw" }, { name: "LOL", uid: 4, acl: "rw" }, { name: "LOLesqe", uid: 7, acl: "rw" }, { name: "KSA", uid: 8, acl: "rw" }];
            cachedMembers.forEach(function (m) {
                m.isAdmin = m.role == ROLE_ADMIN;
                m.color = workspace.getUserColor(m.uid);
                // TODO support idle state
                m.status = workspace.isUserOnline(m.uid) ? "online" : "offline";
                members[m.acl].push(m);

                if (m.uid == me.id) {
                    m.name = "0000"; // top in every sory
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
            myRow.name = "Me";

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
            members: plugin
        });
    }

});