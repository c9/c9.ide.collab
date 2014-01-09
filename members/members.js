/*global window console*/
define(function(require, exports, module) {
"use strict";

main.consumes = ["CollabPanel", "ui", "MembersPanel", "collab", "panels"];
    main.provides = ["members"];
    return main;

    function main(options, imports, register) {
        var CollabPanel  = imports.CollabPanel;
        var collab       = imports.collab;
        var MembersPanel = imports.MembersPanel;
        var ui           = imports.ui;
        var panels       = imports.panels;

        var css          = require("text!./members.css");
        var staticPrefix = options.staticPrefix;

        var membersPanel;

        var plugin = new CollabPanel("Ajax.org", main.consumes, {
            index   : 100,
            caption : "Workspace Members",
            height  : "50%"
        });

        var loaded = false;
        function load() {
            if (loaded) return;
            loaded = true;

            // Import CSS
            ui.insertCss(css, staticPrefix, plugin);
            
            membersPanel = new MembersPanel("Ajax.org", main.consumes, {});
            plugin.on("resize", membersPanel.resize.bind(membersPanel));

            collab.on("show", membersPanel.show.bind(membersPanel));
            collab.on("hide", membersPanel.hide.bind(membersPanel));
        }

        var drawn = false;
        function draw(e) {
            if (drawn) return;
            drawn = true;
            
            membersPanel.draw(e);
            if (panels.isActive("collab"))
                membersPanel.show();
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