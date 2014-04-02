define(function(require, exports, module) {
    main.consumes = [
        "Plugin", "ui", "layout", "menus"
    ];
    main.provides = ["notification.bubble"];
    return main;

    function main(options, imports, register) {
        var Plugin   = imports.Plugin;
        var ui       = imports.ui;
        var menus    = imports.menus;
        var layout   = imports.layout;

        /***** Initialization *****/

        var plugin = new Plugin("Ajax.org", main.consumes);
        var staticPrefix = options.staticPrefix;
        var skin = require("text!./skin.xml");
        var markup = require("text!./bubble.xml");
        var emit   = plugin.getEmitter();
        
        var ntNotifications;
        
        var loaded = false;
        function load() {
            if (loaded) return false;
            loaded = true;
        }
        
        var drawn = false;
        function draw() {
            if (drawn) return;
            drawn = true;
            ui.insertSkin({
                name         : "bubble",
                data         : skin,
                "media-path" : staticPrefix + "/images/"
            }, plugin);
            ui.insertMarkup(layout.findParent(plugin), markup, plugin);
            ntNotifications = plugin.getElement("ntNotifications");
            emit("draw");
        }

        /***** Methods *****/

        function popup(message) {
            draw();
            if (menus.minimized)
                ntNotifications.setAttribute("start-padding", 25);
            else
                ntNotifications.setAttribute("start-padding", 45);
            ntNotifications.popup(message);
        }

        /***** Lifecycle *****/

        plugin.on("load", function() {
            load();
        });
        plugin.on("enable", function() {
        });
        plugin.on("disable", function() {
        });
        plugin.on("unload", function() {
            loaded = false;
            drawn  = false;
        });

        /***** Register and define API *****/
        /**
         * Bubble volatile notifications for CLoud9
         **/
        plugin.freezePublicAPI({
            /**
             * 
             */
            popup : popup,
            _events : [
                /**
                 * @event draw
                 */
                "draw"
            ]
        });

        register(null, {
            "notification.bubble": plugin
        });
    }
});