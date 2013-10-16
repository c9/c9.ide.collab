/*global define console document apf */
define(function(require, module, exports) {
    main.consumes = ["Plugin", "ace", "collab", "collab.connect", "collab.util", "timeslider",
        "CursorLayer", "AuthorLayer"];
    main.provides = ["OTDocument"];
    return main;

    function main(options, imports, register) {
        var Plugin                = imports.Plugin;
        var collab                = imports["collab"];
        var util                  = imports["collab.util"];
        var timeslider            = imports.timeslider;
        var ace                   = imports.ace;
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

        function isReadOnly() {
            return ace.ace.getReadOnly();
        }

        function OTDocument(session, docId, c9Document) {

            var plugin   = new Plugin("Ajax.org", main.consumes);
            var emit     = plugin.getEmitter();

            // Set if the file was loaded using an http request
            var fsContents;

            var docStream;
            var doc, fsHash, docHash, revisions;
            var cursorLayer;
            var authorLayer;

            var rev0Cache;
            var revCache;

            var latestRevNum;
            var lastSel;
            var sendTimer;
            var cursorTimer;

            var outgoing = [];
            var incoming = [];
            var isInited = false;
            var ignoreChanges = false;
            var packedCs = [];

            IndexCache(session.doc);

            session.doc.applyDeltas = function(deltas) {
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
            };

            session.doc.revertDeltas = function(deltas) {
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
            };
            
            session.on("change", handleUserChanges);
            session.selection.addEventListener("changeCursor", onCursorChange);
            session.selection.addEventListener("changeSelection", onCursorChange);
            session.selection.addEventListener("addRange", onCursorChange);
            // needed to provide immediate feedback for remote selection changes caused by local edits
            session.on("change", function(e) { session._emit("changeBackMarker"); });

            var state = "IDLE";

            function handleUserChanges (e) {
                if (!isInited || ignoreChanges || isReadOnly())
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
                var op = packedCs[opOff];
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
                    var workspace = collab.workspace;
                    /*if (aceDoc.fromDelta && aceDoc.fromDelta.authAttribs) {
                        var undoAuthAttribs = aceDoc.fromDelta.authAttribs;
                        var reversedAuthorPool = utils.reverseObject(workspace.authorPool);

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
            var MIN_DELAY = 500;
            var MAX_DELAY = 5000;

            function calculateDelay() {
                var selections = cursorLayer.selections;
                var config = ace.ace.renderer.layerConfig;

                var delay = MAX_DELAY;

                for (var clientId in selections) {
                    delay -= 2000;
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
                    collab.send("EDIT_UPDATE", top);
                }
                if (DEBUG)
                    console.log("[OT] send took", new Date() - st, "ms");
            }

            function setValue(contents) {
                var originalDoc = session.collabDoc.original;
                var state = originalDoc.getState();
                // must use c9doc setValue at first to trigger eventlisteners
                if (!session.c9doc  || session.c9doc.isInited)
                    session.setValue(contents);
                else
                    session.c9doc.setValue(contents);
                originalDoc.setState(state);
                clearCs(contents.length);
            }

            function joinData(data) {
                var st = new Date();

                isInited = false;

                if (data.err)
                    return emit("joined", data.err);

                if (data.chunkNum === 1)
                    docStream = "";
                docStream += data.chunk;

                if (data.chunkNum !== data.chunksLength)
                    return emit("joinProgress", data.chunkNum, data.chunksLength);

                var dataDoc = JSON.parse(docStream);
                docStream = null;

                if (docId !== data.docId)
                    console.error("docId mismatch", docId, data.docId);

                // re-joining the document
                var latestContents;
                if (doc) {
                    syncOfflineEdits(dataDoc);
                    authorLayer.dispose();
                    latestContents = session.doc.getValue();
                }
                else {
                    doc = dataDoc;
                    revCache = {
                        revNum: doc.revNum,
                        contents: doc.contents,
                        authAttribs: cloneObject(doc.authAttribs)
                    };
                    latestContents = syncFileSystemState();
                    cursorLayer = new CursorLayer(session);
                    cursorTimer = setTimeout(changedSelection, 500);
                }

                state = "IDLE";

                latestRevNum = dataDoc.revNum;

                delete dataDoc.selections[collab.workspace.myOldClientId]; // in case of away

                cursorLayer.updateSelections(dataDoc.selections);
                authorLayer = new AuthorLayer(session);

                if (DEBUG)
                    console.log("[OT] init took", new Date() - st, "ms");

                emit("joined", null, latestContents);

                isInited = true;
            }

            function syncOfflineEdits(dataDoc) {
                var workspace = collab.workspace;
                var fromRevNum = latestRevNum + 1;
                var revisions = dataDoc.revisions;
                for (var i = fromRevNum; i < revisions.length; i++) {
                    var rev = revisions[i];
                    if (workspace.myUserId == rev.author)
                        delete rev.operation;
                    handleIncomingEdit({
                        op: rev.operation,
                        revNum: rev.revNum,
                        userId: rev.author,
                        updated_at: rev.updated_at
                    });
                }
                // already synced
                delete dataDoc.authAttribs;
                delete dataDoc.contents;
                delete dataDoc.revisions;

                for (var key in dataDoc)
                    doc[key] = dataDoc[key];
                scheduleSend();
            }

            function syncFileSystemState() {
                var finalContents;

                var currentVal = session.getValue();
                if (typeof fsContents === "string" &&
                    typeof currentVal === "string" &&
                    currentVal !== fsContents) {
                    // an edit was done while the document isn't yet connected
                    var offlineOps = operations.operation(fsContents, currentVal);
                    // if fsContents === doc.contents
                    // collab doc state is synced with the latest filesystem state

                    // Somebody was editing the document when I joined (or I reloaded without saving)
                    // try to apply my edits
                    if (fsContents !== doc.contents) {
                        var collabOps = operations.operation(fsContents, doc.contents);
                        xform(collabOps, offlineOps, function (aPrime, bPrime) {
                            collabOps = aPrime;
                            offlineOps = bPrime;
                        });
                        // console.log("[OT] offlineOps:", offlineOps, "collabOps:", collabOps);
                        finalContents = applyContents(offlineOps, doc.contents);
                    } else {
                        finalContents = currentVal;
                    }

                    if (DEBUG)
                        console.log("[OT] Syncing offline document edits", offlineOps);

                    packedCs = offlineOps;
                    var workspace = collab.workspace;
                    var authorI = workspace.authorPool[workspace.myUserId];
                    applyAuthorAttributes(doc.authAttribs, offlineOps, authorI);

                    scheduleSend();
                }
                else {
                    finalContents = doc.contents;
                }

                fsContents = undefined;

                return finalContents;
            }

            function isPreparedUnity() {
                // Empty doc - or all retain - no user edits
                return !packedCs.length || (packedCs.length === 1 && packedCs[0][0] === "r");
            }

            var lastVal = "";
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
                    var oldOps = ops;
                    var oldMsgOp = msg.op;
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
                    // if (DEBUG > 1)
                    //     debugger;
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

                    // if (DEBUG > 1) {
                    //     msg.oldOp = msg.op;
                    //     var oldOutgoing = outgoing.map(function(out){ return out.op; });
                    //     var oldPackedCs = packedCs;
                    // }

                    outgoing.push({op: packedCs});
                    xformEach(outgoing, msg);

                    // if (DEBUG > 1 && !timeslider.isVisible()) {
                    //     // console.log(JSON.stringify({oldOutgoing: oldOutgoing, lastVal:lastVal, oldPackedCs: oldPackedCs, msg:msg},null,4))
                    //     var startVal = lastVal;
                    //     oldOutgoing.slice().reverse().forEach(function(out){
                    //         var inverseOutgoing = operations.inverse(out);
                    //         startVal = applyContents(inverseOutgoing, lastVal);
                    //     });

                    //     if (lastVal !== oldOutgoing.reduce(function(val, op){ return applyContents(op, val); }, startVal))
                    //         debugger;

                    //     var p0 = applyContents(oldPackedCs, lastVal);
                    //     var p0_1 = applyContents(msg.op, p0);

                    //     var p1 = applyContents(msg.oldOp, startVal);
                    //     var p1_0 = outgoing.reduce(function(p1, msg){
                    //         return applyContents(msg.op, p1);
                    //     }, p1);

                    //     if (p0_1 !== p1_0)
                    //         debugger;
                    // }

                    packedCs = outgoing.pop().op;
                    var sel = session.selection;
                    cursorLayer.setInsertRight(msg.clientId, false);
                    sel.anchor.$insertRight = sel.lead.$insertRight = true;
                    applyEdit(msg, session.doc);
                    sel.anchor.$insertRight = sel.lead.$insertRight = false;
                    cursorLayer.setInsertRight(msg.clientId, true);
                }
                latestRevNum = msg.revNum;
                if (DEBUG)
                    console.log("[OT] handleIncomingEdit took", new Date() - st, "ms", latestRevNum);
            }

            function applyEdit(msg, editorDoc) {
                if (timeslider.isVisible())
                    return;
                ignoreChanges = true;
                applyAce(msg.op, editorDoc);
                applyAuthorAttributes(doc.authAttribs, msg.op, collab.workspace.authorPool[msg.userId]);
                authorLayer.refresh();
                doc.revNum = msg.revNum;
                // if (DEBUG > 1) {
                //     var val = editorDoc.getValue();
                //     var inverseCs = operations.inverse(packedCs);
                //     lastVal = applyContents(inverseCs, val);
                    
                //     if (val !== applyContents(packedCs, lastVal))
                //         debugger;
                // }
                ignoreChanges = false;
            }

            function selectionToData(selection) {
                var data;
                if (selection.rangeCount) {
                    data = selection.rangeList.ranges.map(function(r){
                        return [r.start.row, r.start.column,
                            r.end.row, r.end.column, r.cursor == r.start];
                    });
                } else {
                    var r = selection.getRange();
                    data = [r.start.row, r.start.column,
                        r.end.row, r.end.column, selection.isBackwards()];
                }
                return data;
            }

            function changedSelection() {
                cursorTimer = null;
                var currentSel = Cursors.selectionToData(session.selection);
                if (lastSel && lastSel.join('') === currentSel.join(''))
                    return;
                lastSel = currentSel;
                _self.sendJSON("CURSOR_UPDATE", {
                    docId: docId,
                    selection: lastSel
                });
                if (cursorLayer && cursorLayer.tooltipIsOpen)
                    cursorLayer.hideAllTooltips();
            }

            function onCursorChange() {
                if (!isInited || ignoreChanges)
                    return;
                var sel = session.selection;
                if (cursorTimer ||
                    (lastSel && lastSel.join('') === selectionToData(sel).join('')))
                    return;
                // Don't send too many cursor change messages
                cursorTimer = setTimeout(changedSelection, 200);
            }

            function addRevision(msg) {
                if (!msg.op.length)
                    console.error("[OT] Empty rev operation should never happen !");
                doc.revisions[msg.revNum] = {
                    operation: msg.op,
                    revNum: msg.revNum,
                    author: msg.userId,
                    updated_at: msg.updated_at || Date.now()
                };

                // will throw some error if it's a bad revision
                // if (DEBUG > 1)
                //     getRevWithContent(msg.revNum);
         
                if (activeOT === _self && timeslider.isVisible())
                    timeslider.sliderLength = msg.revNum;
            }

            function getRevWithContent(revNum) {
                var revs = doc.revisions;
                var i;
                // authAttribs can only be edited in the forward way because
                // The user who deleed some text isn't necessarily the one who inserted it
                if (!rev0Cache) {
                    var rev0Contents = revCache.contents;
                    for (i = revCache.revNum; i > 0; i--) {
                        var op = operations.inverse(revs[i].operation);
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
                var workspace = collab.workspace;

                for (i = revCache.revNum+1; i <= revNum; i++) {
                    contents = applyContents(revs[i].operation, contents);
                    applyAuthorAttributes(authAttribs, revs[i].operation, workspace.authorPool[revs[i].author]);
                }
                var rev = cloneObject(revs[revNum]);
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
                var revNums = doc.revisions.length;
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

            function updateToRevNum(revNum) {
                var revisions = doc && doc.revisions;
                if (!revisions || !revisions[0])
                    return console.error("[OT] doc null - document may haven't yet been inited !");
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
                setValue(rev.contents);
                // FIXME not a good practice to have mutable data
                // affecting the behaviour of the app
                doc.authAttribs = rev.authAttribs;
                session._emit("changeBackMarker");
                authorLayer.refresh();
                doc.revNum = revNum;
                ignoreChanges = false;
            }

            function handleMessage(event) {
                var data = event.data;
                switch (event.type) {
                case "EDIT_UPDATE":
                    handleIncomingEdit(data);
                    break;
                case "SYNC_COMMIT":
                    state = "IDLE";
                    // updating it here means the commited operation could sometimes not be
                    // transformed against the previous operation
                    // if (DEBUG > 1) {
                    //     if (latestRevNum != data.revNum)
                    //         debugger;
                    // }
                    if (data.reason.indexOf("OT Error") !== -1) {
                        // if (DEBUG > 1)
                        //     debugger;
                        console.error("[OT] SYNC_COMMIT server OT error");
                    }
                    scheduleSend();
                    break;
                case "CURSOR_UPDATE":
                    cursorLayer && cursorLayer.updateSelection(data);
                    break;
                case "FILE_SAVED":
                    if (data.err) {
                        emit("saved", data.err);
                        break;
                    }

                    if (data.star)
                        doc.starRevNums.push(data.revNum);
                    emit("saved", null, {
                        star: data.star,
                        revision: doc.revisions[data.revNum],
                        clean: !outgoing.length && latestRevNum === data.revNum
                    });
                    break;
                }
            }

            function loadTimeslider() {
                var revisions = doc && doc.revisions;
                if (!revisions || !revisions[0])
                    return console.error("[OT] doc null - document may haven't yet been inited !");
                var numRevs = revisions.length - 1;
                var lastRev = revisions[numRevs];
                var starRevisions = doc.starRevNums.map(function (revNum) {
                    return revisions[revNum];
                });
                timeslider.sliderLength = numRevs;
                timeslider.savedRevisions = starRevisions;
                timeslider.sliderPosition = numRevs;
                timeslider.timer = lastRev.updated_at;
                // Call again to re-render all slider elements
                timeslider.sliderLength = numRevs;

                cursorLayer.hideAllTooltips();
                session._emit("changeBackMarker");
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
                collab.send("SAVE_FILE", {
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
                if (isInited) {
                    cursorLayer.dispose();
                    authorLayer.dispose();
                }
            }

            function leave(clientId) {
                cursorLayer && cursorLayer.clearSelection(clientId);
            }

            function isChanged () {
                var revisions = doc.revisions;
                var lastRev = revisions[revisions.length - 1];
                return !isPreparedUnity() ||
                    (revisions.length > 1 && doc.starRevNums.indexOf(lastRev.revNum) === -1);
            }

            function patchToContents(contents) {
                applyAce(operations.operation(session.getValue(), contents), session.doc);
            }

            plugin.freezePublicAPI({
                get id() { return docId; },
                get session() { return session; },
                get original() { return c9Document; },
                get isInited() { return isInited; },
                get fsHash() { return fsHash; },
                get docHash() { return docHash; },
                set fsContents(contents) { fsContents = contents; },
                get revisions() { return revisions; },
                get cursorLayer() { return cursorLayer; },
                get authorLayer() { return authorLayer; },
                get latestRevNum() { return latestRevNum; },
                get changed() { return isChanged(); },

                leave: leave,
                loadTimeslider: loadTimeslider,
                updateToRevNum:  updateToRevNum,
                save: save,
                historicalSearch: historicalSearch,
                joinData: joinData,
                handleMessage: handleMessage,
                patchToContents: patchToContents,
                dispose: dispose
            });

            return plugin;
        }

        register(null, {
            "OTDocument": OTDocument
        });
    }
});
