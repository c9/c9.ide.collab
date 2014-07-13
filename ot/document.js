define(function(require, module, exports) {
    main.consumes = [
        "Plugin", "ace", "util", "apf",
        "collab.connect", "collab.util", "collab.workspace",
        "timeslider", "CursorLayer", "AuthorLayer", "c9",
        "dialog.alert", "dialog.error", "tabManager"
    ];
    main.provides = ["OTDocument"];
    return main;

    function main(options, imports, register) {
        var Plugin = imports.Plugin;
        var connect = imports["collab.connect"];
        var c9util = imports.util;
        var c9 = imports.c9;
        var apf = imports.apf;
        var workspace = imports["collab.workspace"];
        var timeslider = imports.timeslider;
        var CursorLayer = imports.CursorLayer;
        var AuthorLayer = imports.AuthorLayer;
        var showAlert = imports["dialog.alert"].show;
        var showError = imports["dialog.error"].show;
        var tabs = imports.tabManager;

        var lang = require("ace/lib/lang");
        // var Range = require("ace/range").Range;
        var xform = require("./xform");
        var operations = require("./operations");
        var apply = require("./apply");
        var applyContents = apply.applyContents;
        var applyAce = apply.applyAce;
        var IndexCache = require("./index_cache");
        var applyAuthorAttributes = require("./author_attributes")().apply;

        // The minimum delay that should be between a commited EDIT_UPDATE and the next
        // Happens when I'm collaboratively editing and the collaborators cursors are nearby
        var MIN_DELAY = options.minDelay;
        // The maximum delay that should be between a commited EDIT_UPDATE and the next
        // happens when I'm editing alone
        var MAX_DELAY = options.maxDelay;
        var MAX_COMMIT_TRIALS = 3;
        var SAVE_FILE_TIMEOUT = 5000;

        function OTDocument(docId, c9Document) {

            var plugin = new Plugin("Ajax.org", main.consumes);
            var emit = plugin.getEmitter();
            var cloneObject = c9util.cloneObject;
            var debug = connect.debug;

            var doc, session;
            var docStream, revStream;
            var cursorLayer, authorLayer;
            var revCache, rev0Cache;
            var revisions, starRevNums;

            var latestRevNum, lastSel;
            var commitTrials;
            var sendTimer, cursorTimer, saveTimer;

            var incoming, outgoing;
            var ignoreChanges;
            var packedCs;
            var loaded, loading, inited;
            var state;
            var pendingSave;
            
            c9.on("disconnect", saveWatchDogDisconnect);
            
            resetState();
            
            function resetState() {
                if (session) {
                    session.off("change", handleUserChanges);
                    session.selection.off("changeCursor", onCursorChange);
                    session.selection.off("changeSelection", onCursorChange);
                    session.selection.off("addRange", onCursorChange);
                }
                if (inited) {
                    cursorLayer.dispose();
                    authorLayer.dispose();
                }
                doc = session = docStream = revStream = undefined;
                revCache = rev0Cache = latestRevNum = lastSel = undefined;
                clearTimeout(sendTimer); clearTimeout(cursorTimer); endSaveWatchDog();
                sendTimer = cursorTimer = undefined;
                commitTrials = 0;
                incoming = [];
                outgoing = [];
                packedCs = [];
                revisions = [];
                starRevNums = [];
                loaded = loading = inited = ignoreChanges = false;
                state = "IDLE";
            }

            // @see docs in the API section below
            function setSession(aceSession) {
                if (!aceSession)
                    return console.warn("[OT] setSession null aceSession!");
                if (session)
                    return console.warn("[OT] Ace's session previously set!");

                session = aceSession;
                session.collabDoc = plugin;

                var aceDoc = session.doc;
                IndexCache(aceDoc);
                aceDoc.oldSetValue = aceDoc.oldSetValue || aceDoc.setValue;
                aceDoc.setValue = patchedSetValue.bind(aceDoc);
                // aceDoc.applyDeltas = patchedApplyDeltas.bind(aceDoc);
                // aceDoc.revertDeltas = patchedRevertDeltas.bind(aceDoc);

                if (loaded)
                    joinWithSession();

                incoming.forEach(handleMessage);
                incoming = [];

                session.on("change", handleUserChanges);
                session.selection.addEventListener("changeCursor", onCursorChange);
                session.selection.addEventListener("changeSelection", onCursorChange);
                session.selection.addEventListener("addRange", onCursorChange);
            }

            /**
             * patch the original Ace document's setValue to only apply the edits
             */
            function patchedSetValue (text) {
                var prev = this.getValue();
                if (!prev)
                    return this.oldSetValue(text);
                applyAce(operations.operation(prev, text), this);
            }

            /*
            // Patch the Ace document's applyDeltas to record the deltas's author
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

            // Patch the Ace document's revertDeltas to make use of the deltas's author
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
            */

            /**
             * Record and buffer the user changes to the document into packedCs for it to be sent
             * to the collab server as EDIT_UPDATE
             */
            function handleUserChanges (e) {
                // needed to provide immediate feedback for remote selection changes caused by local edits
                session._emit("changeBackMarker");
                if (!loaded || ignoreChanges)
                    return;
                try {
                    var aceDoc = session.doc;
                    packedCs = handleUserChanges2(aceDoc, packedCs, e.data);
                    scheduleSend();
                } catch (ex) {
                    console.error("[OT] handleUserChanges", ex);
                    reload();
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

            /**
             * Calculate the edit update delays based on the number of clients
             * joined to a document and thier latest updated cursor positions
             */
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
                    doSend();
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

            // send an "EDIT_UPDATE" message, and piggy-pack it with the current seletion
            function doSend() {
                if (state !== "IDLE")
                    return;
                
                if (sendTimer) {
                    clearTimeout(sendTimer);
                    sendTimer = null;
                }
                        

                var st = new Date();
                if (!outgoing.length && !isPackedUnity())
                    addOutgoingEdit();

                if (outgoing.length) {
                    state = "COMMITTING";
                    commitTrials++;
                    var top = outgoing[0];
                    top.revNum = latestRevNum + 1;
                    top.selection = lastSel = CursorLayer.selectionToData(session.selection);
                    if (top.op.filter(function(o) { return o.length > MAX_OP_SIZE; }).length) {
                        connect.send("LARGE_DOC", { docId: top.docId });
                        // TODO: rejoin when doc becomes ok again
                        reportLargeDocument();
                        return leave();
                    }
                    
                    connect.send("EDIT_UPDATE", top);
                    emit("send", { revNum: top.revNum });
                }
                else {
                    onCursorChange();
                }
                if (debug)
                    console.log("[OT] send took", new Date() - st, "ms");
            }

            // Set the Ace document's value and optionally reset and/or bookmark the undo manager
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

            // @see docs in the API section below
            function joinData(data) {
                var st = new Date();
                loaded = false;

                var err = data.err;
                if (err) {
                    if (err.code != "ENOENT" && err.code != "ELARGE")
                        console.error("JOIN_DOC Error:", docId, err);
                    if (err.code == "ELARGE")
                        reportLargeDocument();
                    return emit.sticky("joined", {err: err});
                }

                if (data.chunkNum === 0)
                    docStream = "";
                docStream += data.chunk;

                var complete = data.chunkNum === data.chunksLength - 1;
                var firstChunkBonus = 1;
                if (!c9Document.hasValue())
                    emit("joinProgress", {
                        loaded: data.chunkNum + firstChunkBonus + 1,
                        total: data.chunksLength + firstChunkBonus,
                        complete: complete
                    });

                if (!complete)
                    return;

                try {
                    doc = JSON.parse(docStream);
                } catch(e) {
                    console.error(e, "Stream:", docStream);
                    // try reload
                    return reload();
                } finally {
                    docStream = null;
                }

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
                    // Document was updated to latest state on disk,
                    // but that information won't really help users,
                    // so we're just going to save the state as it is now.
                    saveWatchDog(true);
                    save(pendingSave.silent);
                }

                delete doc.selections[workspace.myOldClientId]; // in case of being away
                delete doc.selections[workspace.myClientId]; // in case of a rejoin (can also be restored, if existing)

                if (session)
                    joinWithSession();

                if (debug)
                    console.log("[OT] init took", new Date() - st, "ms");

                loaded = true;
                loading = false;
                emit.sticky("joined", {contents: doc.contents, metadata: doc.metadata});
            }
            
            function reportLargeDocument(forceReadonly) {
                workspace.loadMembers(function() {
                    if (workspace.accessInfo.admin && !forceReadonly) {
                        if (workspace.minOnlineCount === 1)
                            return;
                        return showError("File is very large, collaborative editing disabled: " + docId, 5000);
                    }
                    showError("File is very large. Collaborative editing disabled: " + docId, 5000);
                    var tab = tabs.findTab(docId);
                    if (!tab || !tab.editor)
                        return;
                    tab.editor.setOption("readOnly", true);
                    tab.classList.add("error");
                });
            }

            /**
             * Completes the initialization of the document after the document has completed loading
             * and EditSession is in place to init authorLayer and cusorLayer
             * inited = true
             */
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

                latestRevNum = doc.revNum;
                cursorTimer = setTimeout(changedSelection, 500);

                cursorLayer && cursorLayer.dispose();
                cursorLayer = new CursorLayer(session, workspace);
                cursorLayer.updateSelections(doc.selections);

                authorLayer && authorLayer.dispose();
                authorLayer = new AuthorLayer(session, workspace); // will refresh on init
                authorLayer.refresh();

                inited = true;
            }

            // Checks if the packesCs is empty & doesn't have real-edit changes
            function isPackedUnity() {
                // Empty doc - or all retain - no user edits
                return !packedCs.length || (packedCs.length === 1 && packedCs[0][0] === "r");
            }

            // Clears the packedCs from any edits
            function clearCs(len) {
                if (!len)
                    packedCs = [];
                else
                    packedCs = ["r"+len];
            }

            // OT-Transform the outgoing edits in regard to the inMsg edit operation and vice versa
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

            // If the edit message doesn't have an 'op' attribute, then, it's my edit
            // The collab server is being smart optimizing huge edits network consumption
            function isOurOutgoing(msg, top) {
                return !msg.op &&
                    // msg.clientId === workspace.myClientId && ---> break tests
                    msg.docId === top.docId &&
                    msg.revNum === top.revNum;
            }

            // Validate and handle incoming edits and OT xform and apply other authors' edits into the document
            // An edit message can also have a piggy-packed selection update - optimization
            function handleIncomingEdit(msg) {
                if (msg.revNum !== latestRevNum + 1) {
                    console.error("[OT] Incoming edit revNum mismatch!",
                        msg.revNum, latestRevNum + 1);
                    return;
                }
                var st = new Date();
                if (outgoing.length && isOurOutgoing(msg, outgoing[0])) {
                    // 'op' not sent to save network bandwidth
                    commitTrials = 0;
                    msg.op = outgoing[0].op;
                    outgoing.shift();
                    addRevision(msg);
                    state = "IDLE";
                    if (pendingSave && --pendingSave.outLen === 0)
                        doSaveFile(pendingSave.silent);
                    scheduleSend();
                } else {
                    addRevision(msg);
                    if (msg.sync) {
                        // revert & discard all my uncommited changesets because:
                        // a- a file watcher caused this document sync on (overriding my changes)
                        // b- my changes may lead to inconsist state or can fail to be applied to the new synced document state
                        console.log("Received new document, discarding any pending changes");
                        revertMyPendingChanges(msg.userId);
                        pendingSave = null;
                    }
                    else {
                        // maintain my outgoing and current changeset
                        outgoing.push({op: packedCs});
                        xformEach(outgoing, msg);
                        packedCs = outgoing.pop().op;
                    }
                    var sel = session.selection;
                    // insert edits on the right of the cursor/selection to not move the user's cursor unexpectedly (done by Google Docs)
                    cursorLayer.setInsertRight(msg.clientId, false);
                    sel.anchor.$insertRight = sel.lead.$insertRight = true;
                    applyEdit(msg, session.doc);
                    sel.anchor.$insertRight = sel.lead.$insertRight = false;
                    // reset the right cursor/selection behaviour
                    cursorLayer.setInsertRight(msg.clientId, true);
                    if (msg.sync) {
                        flagFileSaved(msg, true, true);
                        clearCs(session.getValue().length);
                    }
                }
                latestRevNum = msg.revNum;
                if (msg.selection)
                    cursorLayer.updateSelection(msg);
                if (debug)
                    console.log("[OT] handleIncomingEdit took", new Date() - st, "ms", latestRevNum);
            }

            // If the document is at the latest state, apply a edit into the current document state
            // Else if the timeslider is visible, do nothing - we can later get the contents from the revisions
            function applyEdit(msg, aceDoc) {
                if (timeslider.visible)
                    return;
                var err;
                ignoreChanges = true;
                try {
                    applyAce(msg.op, aceDoc);
                    applyAuthorAttributes(doc.authAttribs, msg.op, workspace.authorPool[msg.userId]);
                } catch(e) {
                    console.error("[OT] applyEdit error:", e);
                    err = e;
                } finally {
                    authorLayer.refresh();
                    doc.revNum = msg.revNum;
                    ignoreChanges = false;

                    // try reload
                    if (err)
                        reload();
                }
            }

            // send a selection update to the collab server if not an exact match of the previous sent selection
            function changedSelection() {
                if (!session || !session.selection) return;
                
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

            // my cursor or selection changes, schedule an update message
            function onCursorChange() {
                if (!loaded || ignoreChanges)
                    return;
                if (cursorTimer)
                    return;
                // Don't send too many cursor change messages
                cursorTimer = setTimeout(changedSelection, 200);
            }

            // Add an author's edit revision to the local revision history
            // Update the timeslider if rendering this document
            function addRevision(msg) {
                if (!msg.op.length)
                    console.error("[OT] Empty rev operation should never happen!");
                revisions[msg.revNum] = {
                    operation: msg.op,
                    revNum: msg.revNum,
                    author: msg.userId,
                    updated_at: msg.updated_at || Date.now()
                };
         
                if (isActiveTimesliderDocument())
                    timeslider.sliderLength = msg.revNum;
            }

            // determines whether the document is the current and visible timeslider's active document or not
            function isActiveTimesliderDocument() {
                return timeslider.visible && timeslider.activeDocument === plugin;
            }

            /**
             * Gets a revision with the contents and authorship attributes of the document at this revision
             * Only works if revisions were previously loaded
             */
            function getDetailedRevision(revNum, contentsOnly) {
                var i;
                // authAttribs can only be edited in the forward way because
                // The user who deleed some text isn't necessarily the one who inserted it
                if (!rev0Cache && !contentsOnly) {
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
                if (!rev)
                    return null;
                rev.contents = contents;
                rev.authAttribs = authAttribs;

                // Update revCache
                revCache.contents = contents;
                revCache.authAttribs = cloneObject(authAttribs);
                revCache.revNum = revNum;
                return rev;
            }

            // @see docs in the API section below
            function historicalSearch(query) {
                var searchString = lang.escapeRegExp(query);
                var revNums = revisions.length;
                var result = {
                    revNums: revNums
                };
                for (var revNo = 0; revNo < revNums; revNo++) {
                    var rev = getDetailedRevision(revNo);
                    var count = 0;
                    if (rev.contents.match(new RegExp(searchString, 'i'))) {
                        count = rev.contents.match(new RegExp(searchString, 'gi')).length;
                        result[revNo] = count;
                    }
                }
                return result;
            }

            function isReadOnly() {
                return c9Document.editor.ace.getReadOnly();
            }

            // @see docs in the API section below
            function updateToRevision(revNum) {
                if (!revisions[0])
                    return console.warn("[OT] revisions may haven't yet been loaded!");
                if (!isReadOnly())
                    return console.error("[OT] Can't updateToRevNum while editing!");
                if (typeof revNum === "undefined")
                    revNum = revisions.length - 1;
                if (debug)
                    console.log("[OT] REV:", revNum);
                if (doc.revNum === revNum)
                    return;
                var rev = getDetailedRevision(revNum);
                timeslider.updateTimer(rev.updated_at);
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

            // @see docs in the API section below
            function revertToRevision(revNum) {
                var latestRev = getDetailedRevision(revisions.length - 1);
                var revertToRev = getDetailedRevision(revNum);

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

            function revertMyPendingChanges(userId) {
                if (!isPackedUnity())
                    outgoing.push({op: packedCs});
                if (!outgoing.length)
                    return;
                console.warn("[OT] Reverting my changes to recover sync or inconsistent state");
                userId = userId || workspace.myUserId;
                ignoreChanges = true;
                outgoing.splice(0, outgoing.length).forEach(function (myEdit) {
                    applyEdit({op: operations.inverse(myEdit.op), userId: userId}, session.doc);
                });
                ignoreChanges = false;
            }

            // @see docs in the API section below
            function handleMessage(event) {
                if (!inited)
                    return incoming.push(event);

                var data = event.data;
                switch (event.type) {
                case "EDIT_UPDATE":
                    handleIncomingEdit(data);
                    break;
                case "SYNC_COMMIT":
                    handleSyncCommit(data);
                    break;
                case "CURSOR_UPDATE":
                    cursorLayer && cursorLayer.updateSelection(data);
                    break;
                case "FILE_SAVED":
                    handleFileSaved(data);
                    break;
                case "GET_REVISIONS":
                   receiveRevisions(data);
                   break;
                 default:
                   console.error("[OT] Unkown document event type:", event.type, docId, event);
               }
            }
            
            function handleSyncCommit(data) {
                console.error("[OT] SYNC_COMMIT", data.reason, data.code);
                state = "IDLE";
                if (data.code == "VERSION_E")
                    latestRevNum = data.revNum;
                if (data.code == "OT_E" || commitTrials > MAX_COMMIT_TRIALS) {
                    revertMyPendingChanges();
                    clearCs(session.getValue().length);
                    commitTrials = 0;
                    if (pendingSave)
                        doSaveFile(pendingSave.silent);
                }
                else {
                    scheduleSend();
                }
            }

            function handleFileSaved(data) {
                endSaveWatchDog();

                var err = data.err;
                if (err) {
                    console.error("[OT] Failed saving file!", err, docId);
                    return emit("saved", {err: err});
                }

                // pendingSave exists: save triggered by me
                // otherwise: other collaborator save
                if (pendingSave) {
                    var rev = getDetailedRevision(data.revNum, true);
                    var value = rev && rev.contents;
                    
                    if (value && apf.crypto.MD5.hex_md5(value) !== data.fsHash) {
                        console.error("[OT] Failed saving file!", err, docId);
                        return emit("saved", {err: "Save content mismatch", code: "EMISMATCH"});
                    }
                    else {
                        console.log("File saved and md5 checksum matched", docId);
                    }
                }

                var isClean = !outgoing.length || latestRevNum === data.revNum;
                var rev = revisions[data.revNum] || {revNum: data.revNum, updated_at: Date.now()};
                flagFileSaved(rev, data.star, isClean);
                pendingSave = null;
            }

            function flagFileSaved(revision, isStar, isClean) {
                emit("saved", {});
                if (isClean) {
                    lang.delayedCall(function() {
                        c9Document.undoManager.bookmark();
                    }).schedule();
                }
                if (isStar) {
                    starRevNums.push(revision.revNum);
                    if (isActiveTimesliderDocument())
                        timeslider.addSavedRevision(revision);
                }
            }

            function receiveRevisions(data) {
               if (data.chunkNum === 0)
                    revStream = "";

                revStream += data.chunk;

                if (data.chunkNum < data.chunksLength - 1)
                    return;

                var revisionsObj = JSON.parse(revStream);
                revStream = null;
                revisions = revisionsObj.revisions;
                starRevNums = revisionsObj.starRevNums;
                emit("revisions", {revisions: revisions, stars: starRevNums});

                if (isActiveTimesliderDocument())
                    loadRevisions();
            }

            // @see docs in the API section below
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
                timeslider.setSavedRevisions(starRevisions);
                timeslider.sliderPosition = numRevs;
                timeslider.updateTimer(lastRev.updated_at);
                // Call again to re-render all slider elements
                timeslider.sliderLength = numRevs;

                cursorLayer.hideAllTooltips();
                authorLayer.refresh();
            }

            // @see docs in the API section below
            function save(silent) {
                saveWatchDog();

                var isUnity = isPackedUnity();
                if (!isUnity)
                    addOutgoingEdit();
                pendingSave = {silent: !!silent, outLen: outgoing.length};
                if (state === "IDLE" && isUnity)
                    return doSaveFile(silent);

                doSend();
            }

            function doSaveFile(silent) {
                saveWatchDog();

                if (!pendingSave)  // should be set, but let's make sure
                   pendingSave = { silent: silent };
                
                connect.send("SAVE_FILE", {
                    docId: docId,
                    silent: !!silent
                });
            }
            
            function saveWatchDog(restart) {
                if (saveTimer && !restart)
                    return;
                endSaveWatchDog();
                
                saveTimer = setTimeout(function onSaveTimeout() {
                    saveTimer = pendingSave = null;
                    emit("saved", {err: "File save timeout", code: "ETIMEOUT"});
                }, SAVE_FILE_TIMEOUT);
            }
            
            function saveWatchDogDisconnect() {
                if (!saveTimer)
                    return;
                endSaveWatchDog();
                c9.once("connect", function() {
                    saveWatchDog(true);
                });
            }
            
            function endSaveWatchDog() {
                clearTimeout(saveTimer);
                saveTimer = null;
            }

            function reload() {
                var sameSession = session;
                resetState();
                setSession(sameSession);
                load();
            }

            // @see docs in the API section below
            function load() {
                loaded = false;
                loading = true;
                connect.send("JOIN_DOC", { docId: docId });
            }

            // @see docs in the API section below
            function leave() {
                connect.send("LEAVE_DOC", { docId: docId });
                resetState();
            }

            // @see docs in the API section below
            function disconnect() {
                loaded = loading = false;
            }

            // @see docs in the API section below
            function clientLeave(clientId) {
                cursorLayer && cursorLayer.clearSelection(clientId);
            }

            // @see docs in the API section below
            function isChanged () {
                var lastRev = revisions[revisions.length - 1];
                return !isPackedUnity() ||
                    (revisions.length > 1 && starRevNums.indexOf(lastRev.revNum) === -1);
            }

            plugin.freezePublicAPI({
                _events: [
                    /**
                     * Fires when the document has joined
                     * @event joined
                     * @param {Object}   e
                     * @param {String}   e.err       the error encountered in joining the document, if any
                     * @param {String}   e.contents  the contents of the joined document
                     */
                    "joined",
                    /**
                     * Fires when the document join progress changes
                     * @event joinProgress
                     * @param {Object}   e
                     * @param {Number}   e.loaded    the error encountered in joining the document, if any
                     * @param {Number}   e.total     the total number of chunks for this document to compeletely join
                     */
                    "joinProgress",
                    /**
                     * Fires when the document is saved
                     * @event saved
                     * @param {Object}   e
                     * @param {Document} e.doc    the document for which the state is set
                     * @param {Object}   e.state  the state object
                     */
                    "saved",
                    /**
                     * Fires when the revisions is loaded
                     * @event revisions
                     * @param {Object}   e
                     * @param [{Revision}] e.revisions    the loaded revisions
                     * @param [{Number}]   e.stars        the star/saved revision numbers
                     */
                    "revisions",
                    /**
                     * Fires when a revision is sent to the server
                     * @event send
                     * @param {Object}   e
                     * @param {Number    e.revNum    the revision sent
                     */
                    "send",
                ],

                /**
                 * Get the collab document id
                 * @property {String} id
                 */
                get id()           { return docId; },
                /**
                 * Get the collab document file path
                 * @property {String} path
                 */
                get path()         { return docId; },
                /**
                 * Get the collab Ace session
                 * @property {EditSession} session
                 */
                get session()      { return session; },
                /**
                 * Get the collab document's original Cloud9 document
                 * @property {Document} c9Document
                 */
                get original()     { return c9Document; },
                /**
                 * Specifies wether the document is loading or not
                 * @property {Boolean} loading
                 */
                get loading()      { return loading; },
                /**
                 * Specifies wether the document has finished loading or not
                 * @property {Boolean} loaded
                 */
                get loaded()       { return loaded; },
                /**
                 * Specifies wether the document has inited with session or not
                 * @property {Boolean} inited
                 */
                get inited()       { return inited; },
                /**
                 * Get the document's file system contents hash at the moment of joining
                 * @property {String} fsHash
                 */
                get fsHash()       { return doc && doc.fsHash; },
                /**
                 * Get the document's contents hash at the moment of joining
                 * @property {String} docHash
                 */
                get docHash()      { return doc && doc.docHash; },
                /**
                 * Get the document's authorship attributes
                 * @property {AuthorAttributes} authAttribs
                 */
                get authAttribs()  { return doc ? doc.authAttribs : []; },
                /**
                 * Get the revisions, if loaded
                 * @property [{Revision}] revisions
                 */
                get revisions()    { return revisions; },
                /**
                 * Get the document's cursor layer if the document was inited
                 * @property {CursorLayer} cursorLayer
                 */
                get cursorLayer()  { return cursorLayer; },
                /**
                 * Get the document's authorship info layer if the document was inited
                 * @property {AuthorLayer} authorLayer
                 */
                get authorLayer()  { return authorLayer; },
                /**
                 * Get the latest revision number
                 * @property {Number} latestRevNum
                 */
                get latestRevNum() { return latestRevNum; },
                /**
                 * Indicates wether the collab document has unsaved changes.
                 * @property {Boolean} changed
                 */
                get changed()      { return isChanged(); },
                /**
                 * Indicates whether the document has changes that pend sending to the server.
                 * @property {Boolean} pendingUpdates
                 */
                get pendingUpdates() { return packedCs.length > 1; },
                /**
                 * Load/Join the document from the collab server
                 * loaded = false
                 * loading = true
                 */
                load: load,
                /**
                 * Sets the document's Ace session when the tab is completely inited and its document's EditSession is created and initialized
                 * This happens on tab/file open, or on first tab focus
                 * @param {EditSession} session
                 */
                setSession: setSession,
                /**
                 * Leave the document
                 * Unload the document and tell the collab server that I'm leaving it
                 */
                leave: leave,
                /**
                 * Dispose the resources used by the document like the cursorLayer and authorLayer and reset its state
                 */
                dispose: resetState,
                /**
                 * Disconnect the document and it will need to reload when the client comes back online
                 */
                disconnect: disconnect,
                /**
                 * A client leaving the document - should clear his selections or cursors
                 */
                clientLeave: clientLeave,
                /**
                 * Load the document's revisions from the collab server
                 */
                loadRevisions: loadRevisions,
                /**
                 * Send any pending updates immediately.
                 */
                sendNow: doSend,
                /**
                 * Update the document to its state on a certain revision number
                 * Only works if the revisions were previously loaded
                 * @param {Number} revNum {optional - defaults to the latest revision number}
                 */
                updateToRevision: updateToRevision,
                /**
                 * Revert the document to its contents at a previous revision
                 * Only works if the revisions were previously loaded
                 * The authorship attributes may differ because the edit operations applied to revert to that revision maybe different
                 * @param {Number} revNum {optional - defaults to the latest revision number}
                 */
                revertToRevision: revertToRevision,
                /**
                 * Save the collab document to the filesystem through the collab server
                 * @param {Boolean} silent - if true, save the file without adding a star revision number
                 */
                save: save,
                /**
                 * Search accross the history of the document for existence of a certain text in any previous revision, with count
                 * @param {String} query - the query string to search the history for
                 */
                historicalSearch: historicalSearch,
                /**
                 * Receive join data chunk messages until the document loads
                 * When the document is loaded:
                 * loaded = true
                 * loading = false
                 * 
                 * @param {Object} data - a chunk of data received of the join data stream
                 */
                joinData: joinData,
                /**
                 * Handles document-related messages of types:
                 * "EDIT_UPDATE", "SYNC_COMMIT", "CURSOR_UPDATE", "FILE_SAVED", "GET_REVISIONS"
                 * @param {Object} data - a chunk of data received of the join data stream
                 */
                handleMessage: handleMessage,
                /**
                 * Report an error about a document being very large.
                 * May not show anything in a single-user/owner scenario.
                 */
                reportLargeDocument: reportLargeDocument
            });

            return plugin;
        }

        register(null, {
            "OTDocument": OTDocument
        });
    }
});
