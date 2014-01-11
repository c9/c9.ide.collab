/*global define console document apf */
define(function(require, module, exports) {
    main.consumes = ["Plugin", "ace", "collab.connect", "collab.util", "collab.workspace", "timeslider",
        "CursorLayer", "AuthorLayer", "util"];
    main.provides = ["OTDocument"];
    return main;

    function main(options, imports, register) {
        var Plugin                = imports.Plugin;
        var connect               = imports["collab.connect"];
        var c9util                = imports.util;
        var workspace             = imports["collab.workspace"];
        var timeslider            = imports.timeslider;
        var CursorLayer           = imports.CursorLayer;
        var AuthorLayer           = imports.AuthorLayer;

        var lang                  = require("ace/lib/lang");
        var Range                 = require("ace/range").Range;
        var xform                 = require("./xform");
        var operations            = require("./operations");
        var apply                 = require("./apply");
        var applyContents         = apply.applyContents;
        var applyAce              = apply.applyAce;
        var IndexCache            = require("./index_cache");
        var applyAuthorAttributes = require("./author_attributes")().apply;

        var MIN_DELAY = options.minDelay;
        var MAX_DELAY = options.maxDelay;

        function OTDocument(docId, c9Document) {

            var plugin      = new Plugin("Ajax.org", main.consumes);
            var emit        = plugin.getEmitter();
            var cloneObject = c9util.cloneObject;
            var DEBUG       = connect.DEBUG;

            var doc, session;
            var docStream, revStream;
            var cursorLayer, authorLayer;
            var revCache, rev0Cache;
            var revisions = [], starRevNums = [];

            var latestRevNum, lastSel;
            var sendTimer, cursorTimer;

            var incoming      = [];
            var outgoing      = [];
            var ignoreChanges = false;
            var packedCs      = [];
            var loaded        = false;
            var loading       = false;
            var inited        = false;
            var state         = "IDLE";

            function setSession(aceSession) {
                if (session)
                    return console.warn("[OT] Ace's session previously set !");

                session = aceSession;
                session.collabDoc = plugin;

                var aceDoc = session.doc;

                IndexCache(aceDoc);

                aceDoc.oldSetValue = aceDoc.oldSetValue || aceDoc.setValue;
                aceDoc.setValue = patchedSetValue.bind(aceDoc);
                aceDoc.applyDeltas = patchedApplyDeltas.bind(aceDoc);
                aceDoc.revertDeltas = patchedRevertDeltas.bind(aceDoc);

                if (loaded)
                    joinWithSession();

                incoming.map(handleMessage);
                incoming = [];

                session.on("change", handleUserChanges);
                session.selection.addEventListener("changeCursor", onCursorChange);
                session.selection.addEventListener("changeSelection", onCursorChange);
                session.selection.addEventListener("addRange", onCursorChange);

                // needed to provide immediate feedback for remote selection changes caused by local edits
                session.on("change", function(e) { session._emit("changeBackMarker"); });
            }

            function patchedSetValue (text) {
                var prev = this.getValue();
                if (!prev)
                    return this.oldSetValue(text);
                applyAce(operations.operation(prev, text), this);
            }

            function patchedApplyDeltas(deltas) {
                for (var i=0; i<deltas.length; i++) {
                    var delta = deltas[i];
                    this.fromDelta = delta;
                    var range = Range.fromPoints(delta.range.start, delta.range.end);

                    if (delta.action == "insertLines")
                        this.insertLines(range.start.row, delta.lines);
                    else if (delta.action == "insertText")
                        this.insert(range.start, delta.text);
                    else if (delta.action == "removeLines")
                        this._removeLines(range.start.row, range.end.row - 1);
                    else if (delta.action == "removeText")
                        this.remove(range);
                }
                this.fromDelta = null;
            }

            function patchedRevertDeltas(deltas) {
                for (var i=deltas.length-1; i>=0; i--) {
                    var delta = deltas[i];
                    this.fromDelta = delta;
                    var range = Range.fromPoints(delta.range.start, delta.range.end);

                    if (delta.action == "insertLines")
                        this._removeLines(range.start.row, range.end.row - 1);
                    else if (delta.action == "insertText")
                        this.remove(range);
                    else if (delta.action == "removeLines")
                        this._insertLines(range.start.row, delta.lines);
                    else if (delta.action == "removeText")
                        this.insert(range.start, delta.text);
                }
                this.fromDelta = null;
            }

            function isReadOnly() {
                return c9Document.editor.ace.getReadOnly();
            }

            function handleUserChanges (e) {
                if (!loaded || ignoreChanges || isReadOnly())
                    return;
                try {
                    var aceDoc = session.doc;
                    packedCs = handleUserChanges2(aceDoc, packedCs, e.data);
                    scheduleSend();
                } catch(ex) {
                    console.error("[OT] handleUserChanges", ex);
                }
            }

            function handleUserChanges2 (aceDoc, packedCs, data) {
                packedCs = packedCs.slice();
                var nlCh = aceDoc.getNewLineCharacter();
                var startOff = aceDoc.positionToIndex(data.range.start);

                var offset = startOff, opOff = 0;
                var op = packedCs[0];
                while (op) {
                    if (operations.type(op) === "delete")
                        ; // process next op
                    else if (offset < operations.length(op))
                        break;
                    else
                        offset -= operations.length(op);
                    op = packedCs[++opOff];
                }

                if (offset !== 0) {
                    var splitted = operations.split(op, offset);
                    packedCs.splice(opOff, 1, splitted[0], splitted[1]);
                    opOff++;
                }

                var authorI;

                if (data.action === "insertText" || data.action === "insertLines") {
                    var newText = data.text || (data.lines.join(nlCh) + nlCh);
                    /*if (aceDoc.fromDelta && aceDoc.fromDelta.authAttribs) {
                        var undoAuthAttribs = aceDoc.fromDelta.authAttribs;
                        var reversedAuthorPool = workspace.reversedAuthorPool;

                        var i = 0;
                        while (i < undoAuthAttribs.length) {
                            var startI = i;
                            authorI = undoAuthAttribs[i++];
                            while (authorI === undoAuthAttribs[i])
                                i++;
                            outgoing.push({
                                docId: docId,
                                op: ["r" + (startOff + startI), "i" + newText.substring(startI, i)],
                                author: reversedAuthorPool[authorI] || -2
                            });
                        }
                        doc.authAttribs.splice.apply(doc.authAttribs, [startOff, 0].concat(undoAuthAttribs));
                    } else {*/
                        // Manage coloring my own edits
                        authorI = workspace.authorPool[workspace.myUserId];
                        packedCs.splice(opOff, 0, "i" + newText);
                        applyAuthorAttributes(doc.authAttribs, ["r" + startOff, "i" + newText], authorI);
                    //}
                }

                else if (data.action === "removeText" || data.action === "removeLines") {
                    var removedText = data.text || (data.lines.join(nlCh) + nlCh);
                    var remainingText = removedText;
                    var opIdx = opOff;
                    var nextOp = packedCs[opIdx];
                    while (remainingText.length) {
                        var opLen = operations.length(nextOp);
                        var toRem = Math.min(remainingText.length, opLen);
                        switch(operations.type(nextOp)) {
                        case "retain":
                            packedCs[opIdx] = "d" + remainingText.substring(0, toRem);
                            if (opLen > remainingText.length)
                                packedCs.splice(opIdx + 1, 0, "r" + (opLen - remainingText.length));
                            remainingText = remainingText.substring(toRem);
                            opIdx++;
                            break;
                        case "insert":
                            packedCs.splice(opIdx, 1);
                            if (opLen > remainingText.length)
                                packedCs.splice(opIdx, 0, operations.split(nextOp, toRem)[1]);
                            remainingText = remainingText.substring(toRem);
                            break;
                        case "delete":
                            opIdx++;
                            break;
                        }
                        nextOp = packedCs[opIdx];
                    }

                    // data.authAttribs = doc.authAttribs.slice(startOff, startOff + removedText.length);
                    applyAuthorAttributes(doc.authAttribs, ["r" + startOff, "d" + removedText], authorI);
                }
                return operations.pack(packedCs);
            }

            // Calculate the edit update delays based on the number of clients
            // joined to a document and thier latest updated cursor positions
            function calculateDelay() {
                var selections = cursorLayer ? cursorLayer.selections : {};
                var aceEditor = c9Document.editor.ace;
                var config = aceEditor.renderer.layerConfig;

                var delay = MAX_DELAY;

                for (var clientId in selections) {
                    delay -= 3000;
                    var ranges = selections[clientId].screenRanges || [];
                    for (var i = 0; i < ranges.length; i++) {
                        var range = ranges[i];
                        var cursorPos = range.start; // range.cursor
                        // same editing region
                        if (config.firstRow <= cursorPos.row && cursorPos.row <= config.lastRow)
                            delay = MIN_DELAY;
                    }
                }
                delay = Math.max(MIN_DELAY, delay);

                return delay;
            }

            function scheduleSend() {
                if (sendTimer)
                    return;
                var delay = pendingSave ? 0 : calculateDelay();
                sendTimer = setTimeout(function () {
                    send();
                    sendTimer = null;
                }, delay);
            }

            function addOutgoingEdit() {
                var uiDoc = session.getValue();
                var msg = {
                    docId: docId,
                    op: operations.pack(packedCs)
                };
                clearCs(uiDoc.length);
                outgoing.push(msg);
            }

            function send() {
                if (state !== "IDLE")
                    return;

                var st = new Date();
                if (!isReadOnly() && !outgoing.length && !isPreparedUnity())
                    addOutgoingEdit();

                if (outgoing.length) {
                    state = "COMMITTING";
                    var top = outgoing[0];
                    top.revNum = latestRevNum + 1;
                    top.selection = lastSel = CursorLayer.selectionToData(session.selection);
                    connect.send("EDIT_UPDATE", top);
                }
                else {
                    onCursorChange();
                }
                if (DEBUG)
                    console.log("[OT] send took", new Date() - st, "ms");
            }

            function setValue(contents, reset, bookmark, callback) {
                var state = c9Document.getState();
                state.value = contents;
                c9Document.setState(state);
                clearCs(contents.length);
                lang.delayedCall(function() {
                    if (reset)
                        c9Document.undoManager.reset();
                    if (bookmark)
                        c9Document.undoManager.bookmark();
                    callback && callback();
                }).schedule();
            }

            function joinData(data) {
                var st = new Date();
                loaded = false;

                if (data.err)
                    return emit("joined", {err: data.err}, true);

                if (data.chunkNum === 1)
                    docStream = "";
                docStream += data.chunk;

                if (data.chunkNum !== data.chunksLength)
                    return emit("joinProgress", {loaded: data.chunkNum, total: data.chunksLength});

                doc = JSON.parse(docStream);
                docStream = null;

                if (docId !== data.docId)
                    console.error("docId mismatch", docId, data.docId);

                revisions = [];
                starRevNums = [];
                revCache = {
                    revNum: doc.revNum,
                    contents: doc.contents,
                    authAttribs: cloneObject(doc.authAttribs)
                };

                state = "IDLE";
                outgoing = [];
                incoming = [];
                if (pendingSave) {
                    emit("saved", {err: "Couldn't save: document rejoined - please try again now"});
                    pendingSave = null;
                }

                delete doc.selections[workspace.myOldClientId]; // in case of being away

                if (session)
                    joinWithSession();

                if (DEBUG)
                    console.log("[OT] init took", new Date() - st, "ms");

                loaded = true;
                loading = false;
                emit("joined", {contents: doc.contents}, true);
            }

            function joinWithSession() {
                var clean = doc.fsHash === doc.docHash;
                if (!clean)
                    console.log("[OT] doc latest state fs diff", docId);

                var currentVal = session.getValue();
                var otherMembersNums = Object.keys(doc.selections).length;
                var latestContents = doc.contents;

                // * re-joining the document - sync my edits if not edited by any other collaborator
                // * previously loaded doc through filesystem: (only me)
                // -----> prioritize current document state
                if (latestRevNum === doc.revNum || (!otherMembersNums && currentVal)) {
                    packedCs = operations.operation(doc.contents, currentVal);
                    scheduleSend();

                    if (!latestRevNum) {
                        var authorI = workspace.authorPool[workspace.myUserId];
                        applyAuthorAttributes(doc.authAttribs, packedCs, authorI);
                    }
                    latestContents = currentVal;
                }
                // * first-joined doc (collab-only)
                // -----> load latest collab doc state
                else if (!latestRevNum) {
                    setValue(doc.contents, clean, clean); // reset and bookmark if clean
                }
                // * previously loaded doc through filesystem: (other members joined)
                // * newer revision on the server
                // -----> Override local edits: prioritize collab doc state (for OT consistency)
                // -----> TODO: nicely merge local and remote edits
                else {
                    // Will auto-aptimize to use 'patchedSetValue'
                    setValue(doc.contents, clean, clean); // reset and bookmark
                }

                cursorLayer = new CursorLayer(session, workspace);
                cursorTimer = setTimeout(changedSelection, 500);

                latestRevNum = doc.revNum;

                cursorLayer.updateSelections(doc.selections);
                authorLayer && authorLayer.dispose();
                authorLayer = new AuthorLayer(session, workspace);

                inited = true;
            }

            function isPreparedUnity() {
                // Empty doc - or all retain - no user edits
                return !packedCs.length || (packedCs.length === 1 && packedCs[0][0] === "r");
            }

            // var lastVal = "";
            function clearCs(len) {
                // if (DEBUG > 1)
                //     lastVal = session.getValue();
                if (!len)
                    packedCs = [];
                else
                    packedCs = ["r"+len];
            }

            function xformEach(outgoing, inMsg) {
                var ops = inMsg.op;
                var msg;

                function k(aPrime, bPrime) {
                    msg.op = aPrime;
                    ops = bPrime;
                }

                for (var i = 0, len = outgoing.length; i < len; i++) {
                    msg = outgoing[i];
                    xform(msg.op, ops, k);
                }
                inMsg.op = ops;
            }

            // Might need to start sending client id's back and forth. Don't really want
            // to have to do a deep equality test on every check here.
            function isOurOutgoing(msg, top) {
                return !msg.op &&
                    // msg.clientId === workspace.myClientId && ---> break tests
                    msg.docId === top.docId &&
                    msg.revNum === top.revNum;
            }

            function handleIncomingEdit(msg) {
                if (msg.revNum !== latestRevNum + 1) {
                    console.error("[OT] Incoming edit revNum mismatch !",
                        msg.revNum, latestRevNum + 1);
                    return;
                }
                var st = new Date();
                if (outgoing.length && isOurOutgoing(msg, outgoing[0])) {
                    // 'op' not sent to save network bandwidth
                    msg.op = outgoing[0].op;
                    outgoing.shift();
                    addRevision(msg);
                    state = "IDLE";
                    if (pendingSave) {
                        pendingSave.outLen--;
                        if (pendingSave.outLen === 0)
                            doSave(pendingSave.silent);
                    }
                    scheduleSend();
                } else {
                    addRevision(msg);
                    outgoing.push({op: packedCs});
                    xformEach(outgoing, msg);
                    packedCs = outgoing.pop().op;
                    var sel = session.selection;
                    cursorLayer.setInsertRight(msg.clientId, false);
                    sel.anchor.$insertRight = sel.lead.$insertRight = true;
                    applyEdit(msg, session.doc);
                    sel.anchor.$insertRight = sel.lead.$insertRight = false;
                    cursorLayer.setInsertRight(msg.clientId, true);
                }
                latestRevNum = msg.revNum;
                if (msg.selection)
                    cursorLayer.updateSelection(msg);
                if (DEBUG)
                    console.log("[OT] handleIncomingEdit took", new Date() - st, "ms", latestRevNum);
            }

            function applyEdit(msg, editorDoc) {
                if (timeslider.visible)
                    return;
                ignoreChanges = true;
                applyAce(msg.op, editorDoc);
                applyAuthorAttributes(doc.authAttribs, msg.op, workspace.authorPool[msg.userId]);
                authorLayer.refresh();
                doc.revNum = msg.revNum;
                ignoreChanges = false;
            }

            function changedSelection() {
                cursorTimer = null;
                var currentSel = CursorLayer.selectionToData(session.selection);
                if (lastSel && lastSel.join('') === currentSel.join(''))
                    return;
                lastSel = currentSel;
                connect.send("CURSOR_UPDATE", {
                    docId: docId,
                    selection: lastSel
                });
                if (cursorLayer && cursorLayer.tooltipIsOpen)
                    cursorLayer.hideAllTooltips();
            }

            function onCursorChange() {
                if (!loaded || ignoreChanges)
                    return;
                if (cursorTimer)
                    return;
                // Don't send too many cursor change messages
                cursorTimer = setTimeout(changedSelection, 200);
            }

            function addRevision(msg) {
                if (!msg.op.length)
                    console.error("[OT] Empty rev operation should never happen !");
                revisions[msg.revNum] = {
                    operation: msg.op,
                    revNum: msg.revNum,
                    author: msg.userId,
                    updated_at: msg.updated_at || Date.now()
                };
         
                if (isActiveTimesliderDocument())
                    timeslider.sliderLength = msg.revNum;
            }

            function isActiveTimesliderDocument() {
                return timeslider.visible && timeslider.activeDocument === plugin;
            }

            function getRevWithContent(revNum) {
                var i;
                // authAttribs can only be edited in the forward way because
                // The user who deleed some text isn't necessarily the one who inserted it
                if (!rev0Cache) {
                    var rev0Contents = revCache.contents;
                    for (i = revCache.revNum; i > 0; i--) {
                        var op = operations.inverse(revisions[i].operation);
                        rev0Contents = applyContents(op, rev0Contents);
                    }
                    rev0Cache = {
                        revNum: 0,
                        contents: rev0Contents,
                        authAttribs: [rev0Contents.length, null]
                    };
                    revCache = null;
                }
                if (!revCache || revCache.revNum > revNum)
                    revCache = cloneObject(rev0Cache);

                var contents = revCache.contents;
                var authAttribs = cloneObject(revCache.authAttribs);

                for (i = revCache.revNum+1; i <= revNum; i++) {
                    contents = applyContents(revisions[i].operation, contents);
                    applyAuthorAttributes(authAttribs, revisions[i].operation, workspace.authorPool[revisions[i].author]);
                }
                var rev = cloneObject(revisions[revNum]);
                rev.contents = contents;
                rev.authAttribs = authAttribs;

                // Update revCache
                revCache.contents = contents;
                revCache.authAttribs = cloneObject(authAttribs);
                revCache.revNum = revNum;
                return rev;
            }

            function historicalSearch(query) {
                var searchString = lang.escapeRegExp(query);
                var revNums = revisions.length;
                var result = {
                    revNums: revNums
                };
                for (var revNo = 0; revNo < revNums; revNo++) {
                    var rev = getRevWithContent(revNo);
                    var count = 0;
                    if(rev.contents.match(new RegExp(searchString, 'i'))) {
                        count = rev.contents.match(new RegExp(searchString, 'gi')).length;
                        result[revNo] = count;
                    }
                }
                return result;
            }

            function updateToRevision(revNum) {
                if (!revisions[0])
                    return console.warn("[OT] revisions may haven't yet been loaded !");
                if (!isReadOnly())
                    return console.error("[OT] Can't updateToRevNum while editing !!");
                if (typeof revNum === "undefined")
                    revNum = revisions.length - 1;
                if (DEBUG)
                    console.log("[OT] REV:", revNum);
                if (doc.revNum === revNum)
                    return;
                var rev = getRevWithContent(revNum);
                timeslider.timer = rev.updated_at;
                ignoreChanges = true;
                // TODO beter manage the undo manager stack: getState() & setState()
                var resetAndBookmark = starRevNums.indexOf(revNum) !== -1;
                setValue(rev.contents, resetAndBookmark, resetAndBookmark);
                // FIXME not a good practice to have mutable data
                // affecting the behaviour of the app
                doc.authAttribs = rev.authAttribs;
                authorLayer.refresh();
                doc.revNum = revNum;
                ignoreChanges = false;
            }

            function revertToRevision(revNum) {
                var latestRev = getRevWithContent(revisions.length - 1);
                var revertToRev = getRevWithContent(revNum);

                ignoreChanges = true;

                // trick the undo manager that we were in a saved sate:
                setValue(revertToRev.contents, false, false); // don't reset or bookmark to keep the doc changed

                var op = operations.operation(latestRev.contents, revertToRev.contents);
                var authAttribs = latestRev.authAttribs;
                var authorI = workspace.authorPool[workspace.myUserId];
                applyAuthorAttributes(authAttribs, op, authorI);
                doc.authAttribs = authAttribs;
                authorLayer.refresh();
        
                packedCs = op;
                scheduleSend();

                ignoreChanges = false;
            }

            function handleMessage(event) {
                if (!inited)
                    return incoming.push(event);

                var data = event.data;
                switch (event.type) {
                case "EDIT_UPDATE":
                    handleIncomingEdit(data);
                    break;
                case "SYNC_COMMIT":
                    state = "IDLE";
                    // updating it here means the commited operation could sometimes not be
                    // transformed against the previous operation
                    if (data.reason.indexOf("OT Error") !== -1) {
                        console.error("[OT] SYNC_COMMIT server OT error");
                    }
                    scheduleSend();
                    break;
                case "CURSOR_UPDATE":
                    cursorLayer && cursorLayer.updateSelection(data);
                    break;
                case "FILE_SAVED":
                    if (data.err) {
                        emit("saved", {err: data.err});
                        break;
                    }

                    if (data.star)
                        starRevNums.push(data.revNum);
                    var clean = !outgoing.length || latestRevNum === data.revNum;
                    if (clean)
                        lang.delayedCall(function() {
                            c9Document.undoManager.bookmark();
                        }).schedule();
                    emit("saved", {
                        star: data.star,
                        revision: revisions[data.revNum],
                        clean: clean
                    });
                    break;
                case "GET_REVISIONS":
                   receiveRevisions(data);
                   break;
                 default:
                   console.error("[OT] Unkown document event type:", event.type, docId, event);
               }
            }

            function receiveRevisions (data) {
               if (data.chunkNum === 1)
                    revStream = "";

                revStream += data.chunk;

                if (data.chunkNum !== data.chunksLength)
                    return;

                var revisionsObj = JSON.parse(revStream);
                revStream = null;
                revisions = revisionsObj.revisions;
                starRevNums = revisionsObj.starRevNums;
                emit("revisions", revisions);

                if (isActiveTimesliderDocument())
                    loadRevisions();
            }

            function loadRevisions() {
                if (!revisions[0]) {
                    console.log("[OT] Loading revisions ...");
                    timeslider.loading = true;
                    connect.send("GET_REVISIONS", { docId: docId });
                    return;
                }
                if (!isActiveTimesliderDocument())
                    return;
                var numRevs = revisions.length - 1;
                var lastRev = revisions[numRevs];
                var starRevisions = starRevNums.map(function (revNum) {
                    return revisions[revNum];
                });
                timeslider.loading = false;
                timeslider.sliderLength = numRevs;
                timeslider.savedRevisions = starRevisions;
                timeslider.sliderPosition = numRevs;
                timeslider.timer = lastRev.updated_at;
                // Call again to re-render all slider elements
                timeslider.sliderLength = numRevs;

                cursorLayer.hideAllTooltips();
                authorLayer.refresh();
            }

            var pendingSave;

            function save(silent) {
                var isUnity = isPreparedUnity();
                if (state === "IDLE" && isUnity)
                    return doSave(silent);
                if (!isUnity)
                    addOutgoingEdit();
                pendingSave = {silent: silent, outLen: outgoing.length};
                if (sendTimer) {
                    clearTimeout(sendTimer);
                    sendTimer = null;
                    scheduleSend();
                }
            }

            function doSave(silent) {
                connect.send("SAVE_FILE", {
                    docId: docId,
                    silent: !!silent
                });
            }

            function dispose() {
                state = "IDLE";
                session.removeListener("change", handleUserChanges);
                session.selection.removeEventListener("changeCursor", onCursorChange);
                session.selection.removeEventListener("changeSelection", onCursorChange);
                session.selection.removeEventListener("addRange", onCursorChange);
                clearTimeout(sendTimer);
                clearTimeout(cursorTimer);
                if (loaded) {
                    cursorLayer.dispose();
                    authorLayer.dispose();
                }
            }

            function load() {
                loaded = false;
                loading = true;
                connect.send("JOIN_DOC", { docId: docId });
            }

            function leave() {
                loaded = loading = false;
                connect.send("LEAVE_DOC", { docId: docId });
            }

            function disconnect() {
                loaded = loading = false;
            }

            function clientLeave(clientId) {
                cursorLayer && cursorLayer.clearSelection(clientId);
            }

            function isChanged () {
                var lastRev = revisions[revisions.length - 1];
                return !isPreparedUnity() ||
                    (revisions.length > 1 && starRevNums.indexOf(lastRev.revNum) === -1);
            }

            plugin.freezePublicAPI({
                get id()           { return docId; },
                get session()      { return session; },
                get original()     { return c9Document; },
                get loading()      { return loading; },
                get loaded()       { return loaded; },
                get inited()       { return inited; },
                get fsHash()       { return doc && doc.fsHash; },
                get docHash()      { return doc && doc.docHash; },
                get authAttribs()  { return doc ? doc.authAttribs : []; },
                get revisions()    { return revisions; },
                get cursorLayer()  { return cursorLayer; },
                get authorLayer()  { return authorLayer; },
                get latestRevNum() { return latestRevNum; },
                get changed()      { return isChanged(); },

                load             : load,
                setSession       : setSession,
                leave            : leave,
                dispose          : dispose,
                disconnect       : disconnect,
                clientLeave      : clientLeave,
                loadRevisions    : loadRevisions,
                updateToRevision : updateToRevision,
                revertToRevision : revertToRevision,
                save             : save,
                historicalSearch : historicalSearch,
                joinData         : joinData,
                handleMessage    : handleMessage
            });

            return plugin;
        }

        register(null, {
            "OTDocument": OTDocument
        });
    }
});
