/**
 * Collab module for the Cloud9 that uses collab
 *
 * @copyright 2012, Ajax.org B.V.
 * @license GPLv3 <http://www.gnu.org/licenses/gpl.txt>
 */
define(function(require, exports, module) {
    main.consumes = ["c9", "Plugin", "ext", "ui", "proc", "vfs"];
    main.provides = ["collab.connect"];
    return main;

    function main(options, imports, register) {
        var Plugin = imports.Plugin;
        var c9 = imports.c9;
        var ext = imports.ext;
        var ui = imports.ui;
        var proc = imports.proc;
        var vfs = imports.vfs;

        /***** Initialization *****/

        var plugin = new Plugin("Ajax.org", main.consumes);
        var emit = plugin.getEmitter();
        var localSeverFile = options.localSeverFile;

        var clientId;

        // 0 - production
        // 1 - development
        // 2 - tracing
        var debug = options.debug;

        // var markup = require("text!./connect.xml");

        var collab;
        var collabInstalled = !options.isSSH;
        var connecting = false;
        var connected = false;
        var fatalError = false;
        var CONNECT_TIMEOUT = 30000;  // 30 seconds
        var IDLE_PERIOD = 300000; // 5 minutes
        var connectMsg;
        var connectTimeout;
        var stream;

        // Idle state handling
        var focussed = true;
        var reportedIdle = false;
        var idleTimeout;

        var loaded = false;
        function load(){
            if (loaded) return;
            loaded = true;

            if (c9.connected)
                connect();

            window.addEventListener("focus", updateIdleWithFocus);
            window.addEventListener("blur", updateIdleWithBlur);

            c9.on("connect", connect);
            c9.on("disconnect", onDisconnect);
        }

        function updateIdleWithFocus() {
            focussed = true;
            clearTimeout(idleTimeout);
            if (!connected || !reportedIdle)
                return;
            send("USER_STATE", {state: "online"});
            reportedIdle = false;
        }
        
        function updateIdleWithBlur() {
            focussed = false;
            if (reportedIdle)
                return;
            clearTimeout(idleTimeout);
            idleTimeout = setTimeout(function() {
                if (!connected)
                    return;
                reportedIdle = true;
                send("USER_STATE", {state: "idle"});
            }, IDLE_PERIOD);
        }
        
        function updateIdleStatus() {
            if (document.hasFocus())
                updateIdleWithFocus();
            else
                updateIdleWithBlur();
        }

        var extended = false;
        function extendCollab(callback) {
            if (collab)
                return callback();
            if (extended)
                return plugin.once("available", callback);
            extended = true;
            
            if (localSeverFile)
                return extend();
            
            require(["text!./server/collab-server.js"], function(code) {
                extend(code);
            });
            
            function extend(code) {
                ext.loadRemotePlugin("collab", {
                    file: !code && "collab-server.js",
                    redefine: true,
                    code: code
                }, function(err, api) {
                    if (err) {
                        extended = false;
                        return callback(err);
                    }
                    collab = api;
    
                    emit.sticky("available");
                    callback();
                });
            }
        }

        function onDisconnect() {
            if (connected || connecting)
                emit("disconnect");
            else
                console.error("[OT] Already disconnected!");
            connecting = connected = extended = false;
            emit.unsticky("available");
            collab = null;
            if (stream) {
                stream.$close();
                stream = null;
            }
            clearTimeout(connectTimeout);
        }

        var drawn = false;
        function draw() {
            if (drawn) return;
            drawn = true;

            // ui.insertMarkup(markup);
            // btnCollabDisable.on("click". function(){
            //    destroy();
            //    winCollabInstall.hide();
            //}
        }
        
        /***** Methods *****/

        function connect() {
            if (fatalError)
                return;
            
            if (connected)
                onDisconnect();

            if (connecting)
                return;

            connecting = true;
            console.log("Collab connecting");
            emit("connecting");
            connectTimeout = setTimeout(function(){
                if (stream) {
                    stream.$close();
                    stream = null;
                }
                connecting = false;
                if (!connected) {
                    console.warn("[OT] Collab connect timed out ! - retrying ...");
                    connect();
                }
            }, CONNECT_TIMEOUT);

            extendCollab(function(err) {
                if (err)
                    return console.error("COLLAB CONNECT ERR", err);
                if (collabInstalled)
                    return doConnect();

                // sshCheckInstall();
            });
        }

        function doConnect() {
            // socket.id
            clientId = vfs.id;
            collab.connect({
                basePath: options.basePath,
                clientId: clientId
            }, function (err, meta) {
                if (err) {
                    fatalError = err.code === "EFATAL";
                    return console.error("COLLAB connect failed", err);
                }

                stream = meta.stream;
                var isClosed = false;

                stream.once("data", onConnect);
                stream.once("end", function (){
                    console.log("COLLAB STREAM END");
                    onClose();
                });
                stream.once("close", function(){
                    console.log("COLLAB STREAM CLOSE");
                    onClose();
                });
                stream.$close = onClose;

                function onData(data) {
                    data = JSON.parse(data);
                    if (debug)
                        console.log("[OT] RECEIVED FROM SERVER", data);
                    emit("message", data);
                }
                function onConnect(data) {
                    data = JSON.parse(data);
                    if (debug)
                        console.log("[OT] RECEIVED FROM SERVER", data);
                    if (data.type !== "CONNECT")
                        return console.error("[OT] Invalid connect data!", data);
                    connected = true;
                    connecting = false;
                    connectMsg = data;
                    console.log("COLLAB connected -", meta.isMaster ? "MASTER" : "SLAVE");
                    emit("connect", data);
                    stream.on("data", onData);
                    clearTimeout(connectTimeout);
                    updateIdleStatus();
                }
                function onClose() {
                    if (isClosed)
                        return;
                    stream.off("data", onData);
                    // stream.destroy();
                    isClosed = true;
                    // onDisconnect();
                }
            });
        }

        function send(msg) {
            if (typeof arguments[0] !== "object")
                msg = {type: arguments[0], data: arguments[1]};
            if (!connected)
                return console.log("[OT] Collab not connected - SKIPPING ", msg);
            if (debug)
                console.log("[OT] SENDING TO SERVER", msg);
            collab.send(clientId, msg);
        }

        /*
        // SSH UI Elements
        var winCollabInstall, collabInstallTitle, collabInstallMsg, btnCollabInstall, btnCollabDisable;

        var SSH_CHECKS = [
            'echo "`command -v sqlite3`"',
            'NODE_PATH=' + options.nodePath + ' ' + options.nodeBin +' -e ' +
             '"try { require(\'sqlite3\'); require(\'sequelize\'); console.log(true); } catch (e) { console.log(false); }"',
            '',
            'BIN_DIR=$(dirname `which '  + options.nodeBin + '`)',
            'export PATH=$BIN_DIR:$PATH', // hack on nvm installed node versions
            'NPM_BIN=$(which npm) || npm',
            'echo "mkdir -p ' + options.nodePath + '"', // result[2]
            'echo "$NPM_BIN --prefix ' + options.nodePath + ' install sequelize@2.0.0-beta.0"', // result[3]
            'echo "$NPM_BIN --prefix ' + options.nodePath + ' install sqlite3@2.1.18"', // result[4]
            // result[5]
            'case `uname` in',
            '  Linux )',
            '     command -v apt-get >/dev/null && { echo "sudo apt-get -y install sqlite3"; exit; }',
            '     command -v yum >/dev/null && { echo "sudo yum install sqlite3"; exit; }',
            '     command -v zypper >/dev/null && { echo "sudo zypper in sqlite3"; exit; }',
            '     ;;',
            '  Darwin )',
            '     echo "sudo port install sqlite3"',
            '     ;;',
            'esac'
        ].join("\n");

        function sshCheckInstall() {
            console.log("COLLAB CHECKS", SSH_CHECKS);
            proc.execFile("bash", {args: ["-c",
                SSH_CHECKS
            ]}, function (err, stdout, stderr) {
                if (err)
                    return console.log("COLLAB-PLUGIN SSH check install failed:", err, stderr);

                var result = stdout.split("\n");

                var missingSqlite = !result[0];
                var missingModules = result[1] === "false";
                if (missingSqlite || missingModules) {
                    draw();
                    var title = "Missing SQLite and/or dependency modules";
                    var installationSteps = [];
                    if (missingModules)
                        installationSteps.push(result[2], result[3], result[4]);
                    if (missingSqlite)
                        installationSteps.push(result[5]);
                    var body = "Cloud9 collaboration features need <b>sqlite3</b> to be available on your workspace.</br></br>" +
                        "Please install them and reload:</br>" +
                        "<p style='font-familt: monospace;'>&nbsp;&nbsp;$ " + installationSteps.join("<br/>&nbsp;&nbsp;$ ") + "</p>" +
                        "<b>Please note that your files won't be accessible during that 1-minute installation</b>";
                    var cmds = installationSteps.join(";\n") + "\n";
                    c9console.showConsoleTerminal();
                    showCollabInstall(title, body);

                    btnCollabInstall.addEventListener("click", function installerClick() {
                        btnCollabInstall.removeEventListener("click", installerClick);
                        var consoleCmdInterv = setInterval(function () {
                            var term = c9console.terminal;
                            if (!term || !term.fd || term.reconnecting || term.restoringState || term.terminated)
                                return console.warn("[OT] Waiting terminal to connect -- cmd:", msg.console);
                            term.send(msg.console + " ; \n"); // execute the command
                            winCollabInstall.hide();
                            clearInterval(consoleCmdInterv);

                            var npmBinaryDelay = msg.console.indexOf("npm") !== -1;

                            setTimeout(function() {
                                util.alert("Collaboration Features", "Install finished?!", "Done installation? - Please reload to enjoy Collaboration features!");
                            }, npmBinaryDelay ? 90000 : 30000);
                        }, 300);
                    });
                }
                else {
                    collabInstalled = true;
                    doConnect();
                }
            });
        }

        function showCollabInstall(title, body) {
            winCollabInstall.show();
            collabInstallTitle.$ext.innerHTML = title;
            collabInstallMsg.$ext.innerHTML = body;
        }
        */

        /***** Lifecycle *****/
        plugin.on("load", function(){
            load();
        });
        plugin.on("enable", function(){

        });
        plugin.on("disable", function(){

        });
        plugin.on("unload", function(){
            loaded = false;
        });

        // Make sure the available event is always called
        plugin.on("newListener", function(event, listener) {
            if (event == "connect" && connected && connectMsg)
                listener(null, connectMsg);
            else if (event == "connecting" && connecting)
                listener();
        });

        /***** Register and define API *****/

        /**
         * Finder implementation using collab
         **/
        plugin.freezePublicAPI({
            _events: [
                /**
                 * Fires when the collab VFS API is extended and available to be used by collab to
                 *  connect a user to the collab server.
                 * @event available
                 */
                "available",
                /**
                 * Fires when the collab is connected, handshaked and a stream is inited
                 *  and pushing messages from the collab server.
                 * @event connect
                 */
                "connect",
                /**
                 * Fires when the collab is connecting to the collab server
                 * @event connecting
                 */
                "connecting",
                /**
                 * Fires when the collab is disconnected
                 * @event disconnect
                 */
                "disconnect",
                /**
                 * Fires when a non-connect message is received on the collab stream
                 * when the collab is connected to the collab server
                 * @event message
                 */
                "message"
            ],
            /**
             * Specifies whether the collab debug is enabled or not
             * @property {Boolean} debug
             */
            get debug()      { return debug; },
            /**
             * Specifies whether the collab is connected or not
             * @property {Boolean} connected
             */
            get connected()  { return connected; },
            /**
             * Specifies whether the collab is connecting or not
             * @property {Boolean} connecting
             */
            get connecting() { return connecting; },

            /**
             * Send a message to the collab server
             * @param  {String}     type    the type of the message
             * @param  {Object}     message the message body to send
             */
            send: send
        });

        register(null, {
            "collab.connect": plugin
        });
    }
});