define(function(require, exports, module) {
    main.consumes = ["Plugin", "collab.util", "api"];
    main.provides = ["collab.workspace"];
    return main;

    function main(options, imports, register) {
        var Plugin   = imports.Plugin;
        var util     = imports["collab.util"];
        var api      = imports.api;

        /***** Initialization *****/

        var plugin = new Plugin("Ajax.org", main.consumes);
        var emit   = plugin.getEmitter();

        var authorPool = {};
        var colorPool  = {};
        var users      = {};
        var loaded     = false;
        var myClientId, myOldClientId, myUserId, fs;
        var reversedAuthorPool, chatHistory;

        /***** Register and define API *****/

        function syncWorkspace(data, mine) {
            if (myClientId !== data.myClientId)
                myOldClientId = myClientId;
            else
                myOldClientId = null;

            myClientId         = data.myClientId;
            myUserId           = data.myUserId;
            fs                 = data.fs;
            authorPool         = data.authorPool;
            reversedAuthorPool = util.reverseObject(authorPool);
            colorPool          = data.colorPool;
            users              = data.users;
            chatHistory        = data.chatHistory;
            loaded             = true;
            emit("sync");
        }

        function leaveClient(uid) {
            var user = users[uid];
            user.online = Math.max(user.online-1, 0);
            emit("sync");
        }

        function joinClient(user) {
            users[user.uid] = user;
            emit("sync");
        }

        function updateUserState(uid, state) {
            users[uid].state = state;
            emit("sync");
        }

        var cachedMembers;
        function loadMembers(callback) {
            if (!options.hosted || cachedMembers) {
                return setCachedMembers(cachedMembers || [
                    { name: "Mostafa Eweda", uid: -1, acl: "rw", role: "a", email: "mostafa@c9.io" },
                    { name: "Lennart Kats", uid: 5, acl: "r", color: "yellow", onlineStatus: "online", email: "lennart@c9.io" },
                    { name: "Ruben Daniels", uid: 2, acl: "rw", color: "blue", onlineStatus: "idle", email: "ruben@ajax.org" },
                    { name: "Bas de Wachter", uid: 8, acl: "rw", color: "purple", email: "bas@c9.io" }
                ]);
            }
            api.collab.get("members/list?pending=0", function (err, data) {
                if (err) return callback(err);
                setCachedMembers(data);
            });

            function setCachedMembers(members) {
                cachedMembers = members;
                callback();
                emit("sync");
            }
        }

        function addMember(username, access, callback) {
            if (!options.hosted) {
                return addCachedMember({
                    uid   : Math.floor(Math.random()*100000),
                    name  : username,
                    acl   : access,
                    email : "s@a.a"
                });
            }
            api.collab.post("members/add", {
                body: {
                    username : username,
                    access   : access
                }
            }, function (err, data, res) {
                if (err) return callback(err);
                addCachedMember(data);
            });

            function addCachedMember(member) {
                cachedMembers && cachedMembers.push(member);
                callback(null, member);
                emit("sync");
            }
        }

        function removeMember(uid, callback) {
            if (!options.hosted)
                return removeCachedMember();

            api.collab.delete("members/remove", {
                body: { uid : uid }
            }, function (err, data, res) {
                if (err) return callback(err);
                removeCachedMember();
            });

            function removeCachedMember() {
                cachedMembers = cachedMembers.filter(function (member) {
                    return member.uid  != uid;
                });
                callback();
                emit("sync");
            }
        }

        function updateAccess(uid, acl, callback) {
            if (!options.hosted)
                return updateCachedAccess();

            api.collab.put("members/update_access", {
                body: {
                    uid    : uid,
                    access : acl
                }
            }, function (err, data, res) {
                if (err) return callback(err);
                updateCachedAccess();
            });

            function updateCachedAccess() {
                (cachedMembers.filter(function (member) {
                    return member.uid  == uid;
                })[0] || {}).acl = acl;
                callback();
                emit("sync");
            }
        }

        function getUserState(uid) {
            var user = users[uid];
            if (!user || !user.online)
                return "offline";
            return user.state || "online";
        }

        plugin.on("newListener", function(event, listener){
            if (event == "sync" && loaded)
                 listener();
        });

        /**
         * Collab workspace that has collab info about the workspace's state at any time for plugins to consume
         * @singleton
         **/
        plugin.freezePublicAPI({
            _events : [
                /**
                 * Fires when another user joins or leaves the workspace and the workspace has synced that state
                 * Or when a workspace member is added or removed or updated access
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
            get users()         { return users; },
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
            get authorPool()    { return authorPool; },
            /**
             * Get the reversed author pool for the collab workspace
             * It's a mapping object that translates author ids to user ids
             *
             *
             * e.g. { <author mini id> : <uid> }
             *
             * @property {Object} reversedAuthorPool
             */
            get reversedAuthorPool() { return reversedAuthorPool; },
            /**
             * Get the color pool for the collab workspace
             * It's a mapping object that translates user ids to their auhtor colors
             *
             * e.g. { <uid>  : {r: 10, g: 15, b: 255} }
             * 
             * @property {Object} colorPool
             */
            get colorPool()     { return colorPool; },
            /**
             * Get the currently connected collab client id
             * @property {String} myClientId
             */
            get myClientId()    { return myClientId; },
            /**
             * Get the previously disconnected collab client id - for checking against USER_LEAVE or LEAVE_DOC notifications
             * @property {String} myOldClientId
             */
            get myOldClientId() { return myOldClientId; },
            /**
             * Get my user id - similar to:
             * info.getUser().uid
             * @property {Number} myUserId
             */
            get myUserId()      { return myUserId; },
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
            get fs()            { return fs; },
            /**
             * Gets the chat history being a list of messages (max. the most recent 100 messages)
             * @property [{Object}] chatHistory
             */
            get chatHistory()   { return chatHistory; },
            /**
             * Gets the cached previously-loaded workspace members
             * @property [{Object}] members
             */
            get members() { return cachedMembers || []; },
            /**
             * Gets the chat history being a list of messages (max. the most recent 100 messages)
             */
            addChatMessage: function (msg) { chatHistory.push(msg); },
            /**
             * Gets a user object given his user id - retriving his full name and email address
             * @param {Number} uid
             * @return {Object} e.g. {fullname: "Mostafa Eweda", uid: 123, email: "mostafa@c9.io", author: 1, color: 2}
             */
            getUser      : function (uid)   { return users[uid]; },
            /**
             * Gets a user color given his user id
             * @param {Number} uid
             * @return {Object} e.g. {r: 10, g: 15, b: 255}
             */
            getUserColor : function (uid)   { return (uid && util.formatColor(colorPool[uid])) || "transparent"; },
            /**
             * Return true if the user with uid is currently online
             * @param {Number} uid
             * @return {String} - the user's online state: idle, online, offline
             */
            getUserState : getUserState,
            /**
             * Synchronize the workspace with the server-synced state
             *
             * @param {Object} data
             * @param {Object} mine - wether or not this is a "CONNECT" sync
             */
            syncWorkspace : syncWorkspace,
            /**
             * Synchronize the workspace metadata that a user is leaving the collaborative workspace
             *
             * @param {String} uid - the user id who is leaving the workspace
             */
            leaveClient   : leaveClient,
            /**
             * Synchronize the workspace metadata that a user is joining the collaborative workspace
             *
             * @param {User} user - the user id who is leaving the workspace
             */
            joinClient    : joinClient,
            /**
             * Synchronize the workspace metadata that a user is joining the collaborative workspace
             *
             * @param {String} uid - the user id who is updating his online state
             * @param {String} state - the updated user state
             */
            updateUserState: updateUserState,
            /**
             * Load the workspace members list from the API server
             *
             * @param {Function} callback
             */
            loadMembers   : loadMembers,
            /**
             * Update workspace member access right to the workspace throgh the API server
             *
             * @param {String}   uid      - the user id
             * @param {Function} callback
             */
            updateAccess  : updateAccess,
            /**
             * Remove workspace member from the workspace throgh the API server
             *
             * @param {String}   uid      - the user id
             * @param {Function} callback
             */
            removeMember  : removeMember,
            /**
             * Add a Cloud9 user as workspace member throgh the API server
             *
             * @param {String}   username - the username or email of the user
             * @param {String}   access   - the access right to the workspace ( read-only ("r") or read+write ("rw") )
             * @param {Function} callback
             */
            addMember     : addMember
        });
        
        register(null, {
            "collab.workspace": plugin
        });
    }
});
