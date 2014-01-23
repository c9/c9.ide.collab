/**
 * File Finder module for the Cloud9 IDE that uses nak
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
         * Collab workspace that has central info about the workspace's collab state at any time for plugins to consume
         **/
        plugin.freezePublicAPI({
            _events : [
                /**
                 * Fires when my collab connects or re-connects and the workspace have synced the state
                 * @event connect
                 */
                "connect",
                /**
                 * Fires when another user joins or leaves the workspace and the workspace has synced that state
                 * @event sync
                 */
                "sync",
            ],
            /**
             * Get a users map with the user id as the key
             * e.g. { uid  : {email: "mostafa@c9.io", fullname: "Mostafa Eweda", uid: 1234} }
             *
             * @property {Object} users
             */
            get users()         { return workspace.users; },
            /**
             * Get the author pool for the collab workspace
             * It's a mapping object that translates user ids to author ids
             *
             * This was introduced to optimize the saving of authorship info
             * in collab documents; author attributes data structure
             *
             * e.g. { <uid>  : <author mini id> }
             *
             * @property {Object} authorPool
             */
            get authorPool()    { return workspace.authorPool; },
            /**
             * Get the color pool for the collab workspace
             * It's a mapping object that translates user ids to their auhtor colors
             *
             * e.g. { <uid>  : {r: 10, g: 15, b: 255} }
             * 
             * @property {Object} colorPool
             */
            get colorPool()     { return workspace.colorPool; },
            /**
             * Get the currently connected collab client id
             * @property {String} myClientId
             */
            get myClientId()    { return workspace.myClientId; },
            /**
             * Get the previously disconnected collab client id - for checking against USER_LEAVE or LEAVE_DOC notifications
             * @property {String} myOldClientId
             */
            get myOldClientId() { return workspace.myOldClientId; },
            /**
             * Get my user id - similar to:
             * info.getUser().uid
             * @property {Number} myUserId
             */
            get myUserId()      { return workspace.myUserId; },
            /**
             * Specifies wether the collab workspace was previously loaded and collab was connected - or not
             * @property {Boolean} loaded
             */
            get loaded()        { return loaded;  },
            /**
             * Gets my filesystem access to this workspace:
             * Values can be either "r" or "rw"
             * @property {String} fs
             */
            get fs()            { return workspace.fs; },
            /**
             * Gets the chat history being a list of messages (max. the most recent 100 messages)
             * @property [{Object}] chatHistory
             */
            get chatHistory()   { return workspace.chatHistory; },
            /**
             * Gets the chat history being a list of messages (max. the most recent 100 messages)
             */
            addChatMessage: function (msg) { workspace.chatHistory.push(msg); },
            /**
             * Gets a user object given his user id - retriving his full name and email address
             * @param {Number} uid
             * @return {Object} e.g. {fullname: "Mostafa Eweda", uid: 123, email: "mostafa@c9.io"}
             */
            getUser      : function (uid)   { return workspace.users[uid]; },
            /**
             * Gets a user color given his user id
             * @param {Number} uid
             * @return {Object} e.g. {r: 10, g: 15, b: 255}
             */
            getUserColor : function (uid)   { return (uid && util.formatColor(workspace.colorPool[uid])) || "transparent"; },
            /**
             * Return true if the user with uid is currently online
             * @param {Number} uid
             * @return {Boolean}
             */
            isUserOnline : function(uid) { return workspace.onlineUserIds.indexOf(uid) !== -1; },
            /**
             * Synchronize the workspace with the server-synced state
             *
             * @param {Object} data
             * @param {Object} mine - wether or not this is a "CONNECT" sync
             */
            sync         : syncWorkspace
        });
        
        register(null, {
            "collab.workspace": plugin
        });
    }
});
