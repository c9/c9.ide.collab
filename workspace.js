define(function(require, exports, module) {
    main.consumes = ["Plugin", "collab.util", "api", "pubsub", "info", "dialog.alert"];
    main.provides = ["collab.workspace"];
    return main;

    function main(options, imports, register) {
        var Plugin = imports.Plugin;
        var util = imports["collab.util"];
        var api = imports.api;
        var pubsub = imports.pubsub;
        var info = imports["info"];
        var showAlert = imports["dialog.alert"].show;

        /***** Initialization *****/

        var plugin = new Plugin("Ajax.org", main.consumes);
        var emit = plugin.getEmitter();
        
        var isAdmin = options.isAdmin;

        var authorPool = {};
        var colorPool = {};
        var users = {};
        var onlineCount = 0;

        var myUserId = info.getUser().id;
        var loadedWorkspace = false;
        var myClientId, myOldClientId, fs;
        var reversedAuthorPool, chatHistory;
        
        var loaded = false;
        function load() {
            if (loaded) return;
            loaded = true;
            pubsub.on("message", function(message) {
                if (message.type != "collab")
                    return;
                console.log("PubSub collab API message", message);
                var action = message.action;
                var body = message.body;
                var uid = body.uid;
                switch (action) {
                    case "add_member":
                        addCachedMember(body);
                        if (myUserId == uid) {
                            showAlert("Workspace Access Changed",
                                body.acl == "rw"
                                    ? "You have been granted read/write access to this workspace."
                                    : "You have been granted readonly access to this workspace.",
                                "To continue, Cloud9 will be reloaded.", function() { reloadWorkspace(1000); });
                        }
                        break;
                    case "update_member_access":
                        updateCachedAccess(uid, body.acl);
                        if (myUserId == uid) {
                            showAlert("Workspace Access Changed",
                                body.acl == "rw"
                                    ? "You have been granted read/write access to the workspace."
                                    : "You workspace access has been limited to read-only.",
                                "To continue, Cloud9 will be reloaded.", function() { reloadWorkspace(1000); });
                        }
                        break;
                    case "remove_member":
                        removeCachedMember(uid);
                        if (body.uid == myUserId) {
                            showAlert("Workspace Access Revoked",
                                "You have been removed from the list of members of this workspace.",
                                "To continue, Cloud9 will be reloaded.", function() { reloadWorkspace(1000); });
                        }
                        break;
                    case "request_access":
                        var notif = { type: "access_request", name: body.name, uid: body.uid, email: body.email };
                        emit("notification", notif);
                        break;
                    case "accept_request":
                        reloadWorkspace();
                        break;
                    case "deny_request":
                        reloadWorkspace();
                        break;
                    default:
                        console.warn("Unhandled pubsub collab action:", action, message);
                }
            });
        }
        
        function reloadWorkspace(afterTimeout) {
            setTimeout(function() {
                window.location.reload();
            }, afterTimeout || 10);
        }

        /***** Register and define API *****/

        function syncWorkspace(data, mine) {
            if (myClientId !== data.myClientId)
                myOldClientId = myClientId;
            else
                myOldClientId = null;

            myClientId = data.myClientId;
            fs = data.fs;
            authorPool = data.authorPool;
            reversedAuthorPool = util.reverseObject(authorPool);
            colorPool = data.colorPool;
            users = data.users;
            chatHistory = data.chatHistory;
            loadedWorkspace = true;
            onlineCount = 1;
            emit("sync");
        }

        function leaveClient(uid) {
            var user = users[uid];
            user.online = Math.max(user.online-1, 0);
            onlineCount--;
            emit("sync");
        }

        function joinClient(user) {
            var uid = user.uid;
            var authorId = user.author;
            users[uid] = user;
            authorPool[uid] = authorId;
            reversedAuthorPool[authorId] = uid;
            colorPool[uid] = user.color;
            onlineCount++;
            emit("sync");
        }

        function updateUserState(uid, state) {
            users[uid].state = state;
            emit("sync");
        }

        var cachedMembers;
        var cachedInfo;
        function loadMembers(callback) {
            if (!options.hosted || cachedMembers) {
                // Use mock data
                return done(
                    cachedMembers || [
                        { name: "John Doe", uid: -1, acl: "rw", role: "a", email: "johndoe@c9.io" },
                        { name: "Mostafa Eweda", uid: -1, acl: "rw", color: "green", email: "mostafa@c9.io" },
                        { name: "Lennart Kats", uid: 5, acl: "r", color: "yellow", onlineStatus: "online", email: "lennart@c9.io" },
                        { name: "Ruben Daniels", uid: 2, acl: "rw", color: "blue", onlineStatus: "idle", email: "ruben@ajax.org" },
                        { name: "Bas de Wachter", uid: 8, acl: "rw", color: "purple", email: "bas@c9.io" }
                    ],
                    cachedInfo || { admin: true, member: true, pending: false, private: false, appPublic: true, previewPublic: true }
                );
            }
            api.collab.get("access_info", function (err, info) {
                if (err && err.code === 0) {
                    // Server still starting or CORS error; retry
                    return setTimeout(loadMembers.bind(null, callback), 20000);
                }
                
                if (err) return callback(err);
                if (!info.member)
                    return done([], info);
                    
                api.collab.get("members/list?pending=0", function (err, data) {
                    if (err && err.code !== 403) return callback(err);
                    done(!err && data || [], info);
                });
            });

            function done(members, info) {
                cachedMembers = members;
                cachedInfo = info;
                callback();
                emit("sync");
            }
        }

        function addMember(username, access, callback) {
            if (!options.hosted) {
                return addCachedMember({
                    uid: Math.floor(Math.random()*100000),
                    name: username,
                    acl: access,
                    email: "s@a.a"
                }, callback);
            }
            api.collab.post("members/add", {
                body: {
                    username: username,
                    access: access
                }
            }, function (err, data, res) {
                if (err) return callback(err);
                if (!pubsub.connected) // pubsub not working
                    addCachedMember(data, callback);
                // normally, pubsub will handle it for all clients
            });
        }

        function addCachedMember(member, next) {
            if (!cachedMembers)
                return console.warn("addCachedMember() - cachedMembers = null !");
            cachedMembers = cachedMembers.filter(function (m) {
                return m.uid  != member.uid;
            });
            cachedMembers.push(member);
            emit("sync");
            next && next(null, member);
        }

        function removeMember(uid, callback) {
            if (!options.hosted)
                return removeCachedMember(uid, callback);

            api.collab.delete("members/remove", {
                body: { uid : uid }
            }, function (err, data, res) {
                if (err) return callback(err);
                if (!pubsub.connected) // pubsub not working
                    removeCachedMember(uid, callback);
                // normally, pubsub will handle it for all clients
            });
        }
        
        function removeCachedMember(uid, next) {
            if (!cachedMembers)
                return console.warn("removeCachedMember() - cachedMembers = null !");
            cachedMembers = cachedMembers.filter(function (member) {
                return member.uid  != uid;
            });
            emit("sync");
            next && next();
        }

        function updateAccess(uid, acl, callback) {
            if (!options.hosted)
                return updateCachedAccess(uid, acl, callback);

            api.collab.put("members/update_access", {
                body: {
                    uid: uid,
                    access: acl
                }
            }, function (err, data, res) {
                if (err) return callback(err);
                if (!pubsub.connected) // pubsub not working
                    updateCachedAccess(uid, acl, callback);
                // normally, pubsub will handle it for all clients
            });
        }
        
        function updateCachedAccess(uid, acl, next) {
            if (!cachedMembers)
                return console.warn("updateCachedAccess() - cachedMembers = null !");
            (cachedMembers.filter(function (member) {
                return member.uid  == uid;
            })[0] || {}).acl = acl;
            emit("sync");
            next && next();
        }

        function getUserState(uid) {
            var user = users[uid];
            if (!user || !user.online)
                return "offline";
            return user.state || "online";
        }
        
        function addMemberNonPubSub(member) {
            if (!pubsub.connected) // pubsub not working
                addCachedMember(member);
            // normally, pubsub will handle it for all clients
        }

        /***** Lifecycle *****/

        plugin.on("load", function(){
            load();
        });

        plugin.on("newListener", function(event, listener) {
            if (event == "sync" && loadedWorkspace)
                 listener();
        });

        /**
         * Collab workspace that has collab info about the workspace's state at any time for plugins to consume
         * @singleton
         **/
        plugin.freezePublicAPI({
            _events: [
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
             * info.getUser().id
             * @property {Number} myUserId
             */
            get myUserId()      { return myUserId; },
            /**
             * Specifies wether the collab workspace was previously loaded and collab was connected - or not
             * @property {Boolean} loaded
             */
            get loaded()        { return loadedWorkspace;  },
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
             * Gets the approximate number of users/browser tabs currently online on this workspace.
             * Not fully accurate, but should reflect a lower bound for the number of users.
             */
            get onlineCount() { return onlineCount; },
            /**
             * Gets the cached previously-loaded acccess information
             * @property {Object} info
             */
            get accessInfo() { return cachedInfo || {}; },
            /**
             * Gets whether the user is admin
             * @property {Object} isAdmin
             */
            get isAdmin() { return isAdmin; },
            /**
             * Gets the chat history being a list of messages (max. the most recent 100 messages)
             */
            addChatMessage: function (msg) { chatHistory.push(msg); },
            /**
             * Gets a user object given his user id - retriving his full name and email address
             * @param {Number} uid
             * @return {Object} e.g. {fullname: "Mostafa Eweda", uid: 123, email: "mostafa@c9.io", author: 1, color: 2}
             */
            getUser: function (uid)   { return users[uid]; },
            /**
             * Gets a user color given his user id
             * @param {Number} uid
             * @return {Object} e.g. {r: 10, g: 15, b: 255}
             */
            getUserColor: function (uid)   { return (uid && util.formatColor(colorPool[uid])) || "transparent"; },
            /**
             * Return true if the user with uid is currently online
             * @param {Number} uid
             * @return {String} - the user's online state: idle, online, offline
             */
            getUserState: getUserState,
            /**
             * Synchronize the workspace with the server-synced state
             *
             * @param {Object} data
             * @param {Object} mine - wether or not this is a "CONNECT" sync
             */
            syncWorkspace: syncWorkspace,
            /**
             * Synchronize the workspace metadata that a user is leaving the collaborative workspace
             *
             * @param {String} uid - the user id who is leaving the workspace
             */
            leaveClient: leaveClient,
            /**
             * Synchronize the workspace metadata that a user is joining the collaborative workspace
             *
             * @param {User} user - the user id who is leaving the workspace
             */
            joinClient: joinClient,
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
            loadMembers: loadMembers,
            /**
             * Update workspace member access right to the workspace throgh the API server
             *
             * @param {String}   uid      - the user id
             * @param {Function} callback
             */
            updateAccess: updateAccess,
            /**
             * Remove workspace member from the workspace throgh the API server
             *
             * @param {String}   uid      - the user id
             * @param {Function} callback
             */
            removeMember: removeMember,
            /**
             * Add a Cloud9 user as workspace member throgh the API server
             *
             * @param {String}   username - the username or email of the user
             * @param {String}   access   - the access right to the workspace ( read-only ("r") or read+write ("rw") )
             * @param {Function} callback
             */
            addMember: addMember,
            /*
             * Adds a member to the workspace UI if pubsub isn't enabled
             * @param {Object} member
             */
            addMemberNonPubSub: addMemberNonPubSub,
        });
        
        register(null, {
            "collab.workspace": plugin
        });
    }
});
