/**
 * File Finder module for the Cloud9 IDE that uses nak
 *
 * @copyright 2012, Ajax.org B.V.
 * @license GPLv3 <http://www.gnu.org/licenses/gpl.txt>
 */
define(function(require, exports, module) {
    main.consumes = ["c9", "Plugin", "ext", "fs"];
    main.provides = ["collab"];
    return main;

    function main(options, imports, register) {
        var Plugin   = imports.Plugin;
        var c9       = imports.c9;
        var ext      = imports.ext;
        var fs       = imports.fs;
        
        /***** Initialization *****/
        
        var plugin = new Plugin("Ajax.org", main.consumes);
        var emit   = plugin.getEmitter();
        
        var CODE   = require("text!./collab-server.js");
        
        var collab;
        
        var loaded = false;
        function load(callback){
            if (loaded) {
                plugin.once("available", callback);
                return;
            }
            loaded = true;
            
            ext.loadRemotePlugin("nak", {
                code     : CODE,
                redefine : true
            }, function(err, api){
                if (err) return callback(err);
                collab = api;
                
                emit("available", null, collab);
                callback(null, collab);
            });
            
            c9.on("stateChange", function(e){
                if (e.state & c9.NETWORK) {
                    collab = null;
                }
                else {
                    loaded = false;
                }
            });
        }
        
        // Make sure the available event is always called
        plugin.on("newListener", function(event, listener){
            if (event == "available" && collab)
                listener(null, collab);
        });
        
        /***** Methods *****/
        
        function connect(args, callback){
            load(function(err, api){
                if (err) return callback(err);
                api.connect(args, callback);
            });
        }
        
        plugin.on("load", function(){
        });
        
        /***** Register and define API *****/
        
        /**
         * Finder implementation using nak
         **/
        plugin.freezePublicAPI({
            connect : connect
        });
        
        register(null, {
            collab: plugin
        });
    }
});