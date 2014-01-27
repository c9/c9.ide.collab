/**
 * File Finder module for the Cloud9 that uses nak
 *
 * @copyright 2012, Ajax.org B.V.
 * @license GPLv3 <http://www.gnu.org/licenses/gpl.txt>
 */
define(function(require, exports, module) {
    main.consumes = ["Plugin", "collab.util"];
    main.provides = ["collab.workspace"];
    return main;

    function main(options, imports, register) {
        var Plugin   = imports.Plugin;
        var util     = imports["collab.util"];

        /***** Initialization *****/

        var plugin = new Plugin("Ajax.org", main.consumes);
        var emit   = plugin.getEmitter();

        var workspace = { authorPool: {}, colorPool: {}, users: {}, onlineUserIds: [] };
        var loaded    = false;
        /***** Register and define API *****/

        function syncWorkspace(data, mine) {
            if (mine) {
                if (workspace.myClientId !== data.myClientId)
                    workspace.myOldClientId = workspace.myClientId;
                else
                    workspace.myOldClientId = null;
            }

            workspace.authorPool         = data.authorPool;
            workspace.reversedAuthorPool = util.reverseObject(workspace.authorPool);
            workspace.colorPool          = data.colorPool;
            workspace.users              = data.users;
            workspace.onlineUserIds      = data.onlineUserIds;

            if (mine) {
                workspace.myClientId  = data.myClientId;
                workspace.myUserId    = data.myUserId;
                workspace.fs          = data.fs;
                workspace.chatHistory = data.chatHistory;
                loaded                = true;
                emit("connect");
            }
            emit("sync");
        }


        plugin.on("newListener", function(event, listener){
            if ((event == "connect" || event == "sync") && loaded)
                 listener();
        });

        /**
         * Finder implementation using nak
         **/
        plugin.freezePublicAPI({
            get users()         { return workspace.users; },
            get authorPool()    { return workspace.authorPool; },
            get colorPool()     { return workspace.colorPool; },
            get myClientId()    { return workspace.myClientId; },
            get myOldClientId() { return workspace.myOldClientId; },
            get myUserId()      { return workspace.myUserId; },
            get loaded()        { return loaded;  },
            get fs()            { return workspace.fs; },
            get chatHistory()   { return workspace.chatHistory; },

            addChatMessage: function (msg) { workspace.chatHistory.push(msg); },
            getUser      : function (uid)   { return workspace.users[uid]; },
            getUserColor : function (uid)   { return (uid && util.formatColor(workspace.colorPool[uid])) || "transparent"; },
            isUserOnline : function(uid) { return workspace.onlineUserIds.indexOf(uid) !== -1; },
            sync         : syncWorkspace
        });
        
        register(null, {
            "collab.workspace": plugin
        });
    }
});