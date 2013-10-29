/*global document window setTimeout */
define(function(require, exports, module) {
    "use strict";
    
    main.consumes = ["Plugin", "c9", "ui", "ace", "tabManager", "settings", "menus", "commands", "save"];
    main.provides = ["timeslider"];
    return main;

    function main(options, imports, register) {
        var Plugin       = imports.Plugin;
        var c9           = imports.c9;
        var ui           = imports.ui;
        var ace          = imports.ace;
        var tabs         = imports.tabManager;
        var settings     = imports.settings;
        var menus        = imports.menus;
        var commands     = imports.commands;
        var save         = imports.save;

        var html         = require("text!./timeslider.html");
        var css          = require("text!./timeslider.css");
        var dom          = require("ace/lib/dom");

        var staticPrefix = options.staticPrefix;

        var tsVisibleKey = "user/collab/@timeslider-visible";
        // timeslider keyboard handler
        var timesliderKeyboardHandler = {
            handleKeyboard: function(data, hashId, keystring) {
                if (keystring == "esc") {
                    forceHideSlider();
                    return {command: "null"};
                }
            }
        };

        // UI elements
        var container, timeslider, editorContainer, timesliderClose, slider, sliderBar, handle,
            playButton, playButtonIcon, revisionDate, revisionLabel, leftStep, rightStep;

        var activeDocument;

        /***** Initialization *****/

        var plugin   = new Plugin("Ajax.org", main.consumes);
        var emit     = plugin.getEmitter();

        var sliderLength      = 1000;
        var sliderPos         = 0;
        var sliderActive      = false;
        var savedRevisions    = [];
        var savedRevisionNums = [];
        var sliderPlaying     = false;
        // This number is calibrated from UI experimentation
        var LEFT_PADDING      = 59;

        var loaded   = false;
        function load(callback){
            if (loaded) return false;
            loaded = true;

            commands.addCommand({
                name: "toggleTimeslider",
                exec: toggleTimeslider,
                isAvailable: timesliderAvailable
            }, plugin);

            commands.addCommand({
                name: "forceToggleTimeslider",
                exec: function(){
                    var isVisible = settings.getBool(tsVisibleKey);
                    settings.set(tsVisibleKey, !isVisible);
                    toggleTimeslider();
                },
                isAvailable: timesliderAvailable
            }, plugin);

            menus.addItemByPath("File/File Revision History...", new ui.item({
                type: "check",
                checked: "[{settings.model}::" + tsVisibleKey + "]",
                command: "toggleTimeslider"
            }), 600, plugin);

            settings.on("read", function () {
                // force-hide-timeslider with initial loading
                settings.set(tsVisibleKey, false);
            }, plugin);

            // right click context item in ace
            var mnuCtxEditorFileHistory = new ui.item({
                caption: "File History",
                command: "forceToggleTimeslider"
            }, plugin);

            ace.getElement("menu", function(menu) {
                menus.addItemToMenu(menu, mnuCtxEditorFileHistory, 600, plugin);
                menus.addItemToMenu(menu, new ui.divider(), 650, plugin);
                menu.on("prop.visible", function(e) {
                    // only fire when visibility is set to true
                    if (e.value) {
                        var editor = tabs.focussedTab.editor;
                        if (timesliderAvailable(editor))
                            mnuCtxEditorFileHistory.enable();
                        else
                            mnuCtxEditorFileHistory.disable();
                    }
                });
            });

            tabs.on("paneDestroy", function (e){
                if (!tabs.getPanes(tabs.container).length)
                    forceHideSlider();
            }, plugin);

            tabs.on("tabDestroy", function(e) {
                var doc = getTabCollabDocument(e.tab);
                if (activeDocument === doc)
                    activeDocument = null;
            }, plugin);

            tabs.on("focusSync", function(e) {
                var doc = getTabCollabDocument(e.tab);
                activeDocument = doc;
                if (!isVisible)
                    return;
                if (!doc || !doc.isInited || !doc.revisions || !doc.revisions[0])
                    forceHideSlider();
                else
                    doc.loadTimeslider();
            }, plugin);

            save.on("beforeSave", function(e) {
                if (isVisible)
                    return false;
            }, plugin);

            plugin.on("slider", function (revNum) {
                var doc = activeDocument;
                if (!doc || !isVisible)
                    return;

                doc.updateToRevNum(revNum);
            });
        }

        var drawn = false;
        function draw () {
            if (drawn) return;
            drawn = true;

            ui.insertHtml(null, html, plugin);
            ui.insertCss(css, staticPrefix, plugin);

            function $(id) {
                return document.getElementById(id);
            }

            container       = $("timeslider-top");
            timeslider      = $("timeslider");
            timesliderClose = $("timesliderClose");
            slider          = $("timeslider-slider");
            sliderBar       = $("ui-slider-bar");
            handle          = $("ui-slider-handle");
            playButton      = $("playpause_button");
            playButtonIcon  = $("playpause_button_icon");
            revisionDate    = $("revision_date");
            revisionLabel   = $("revision_label");
            leftStep        = $("leftstep");
            rightStep       = $("rightstep");

            // HACKY WAY to get the correct div without jQuery selector: $(".basic.codeditorHolder")
            var editorHolders = document.getElementsByClassName("codeditorHolder");
            editorHolders = toArray(editorHolders);
            editorContainer = editorHolders.filter(function (holder) {
                return holder.classList.contains("basic");
            })[0];

            timesliderClose.addEventListener("click", function() {
                forceHideSlider();
            });

            editorContainer.insertBefore(container, editorContainer.firstChild);

            disableSelection(playButton);
            disableSelection(timeslider);

            window.addEventListener("resize", function() {
                updateSliderElements();
            });

            slider.addEventListener("mousedown", function(evt) {
                if (evt.target.className == "star" && !sliderActive)
                    onBarMouseDown(evt);
            });
            
            sliderBar.addEventListener("mousedown", onBarMouseDown);

            // Slider dragging
            handle.addEventListener("mousedown", onHandleMouseDown);

            // play/pause toggling
            playButton.addEventListener("mousedown", function(evt) {
                playButton.style["background-image"] = "url("+ staticPrefix + "/images/play_depressed.png)";
                playButton.addEventListener("mouseup", function onMouseUp(evt2) {
                    playButton.style["background-image"] = "url(" + staticPrefix + "/images/play_undepressed.png)";
                    playButton.removeEventListener("mouseup", onMouseUp);
                    playpause();
                });
                document.addEventListener("mouseup", function onMouseUp(evt2) {
                    playButton.style["background-image"] = "url(" + staticPrefix + "/images/play_undepressed.png)";
                    document.removeEventListener("mouseup", onMouseUp);
                });
            });

            // next/prev revisions and changeset
            var steppers = [leftStep, rightStep];
            steppers.forEach(function (stepper) {
                stepper.addEventListener("mousedown", function(evt) {
                    var origcss = stepper.style["background-position"];
                    if (!origcss)
                        origcss = stepper.style["background-position-x"].split("px")[0] + " " + stepper.style["background-position-y"].split("px")[0];
                    var origpos = parseInt(origcss.split(" ")[1], 10);
                    var newpos = origpos - 43;
                    if (newpos < 0)
                        newpos += 87;

                    var newcss = (origcss.split(" ")[0] + " " + newpos + "px");
                    if (stepper.style.opacity != 1.0)
                        newcss = origcss;

                    stepper.style["background-position"] = newcss;

                    var pos, nextStar, i;

                    stepper.addEventListener("mouseup", function onMouseUp(evt2) {
                        stepper.style["background-position"] = origcss;
                        stepper.removeEventListener("mouseup", onMouseUp);
                        // document.removeEventListener("mouseup". onMouseUp);
                        var id = stepper.id;
                        if (id == "leftstep") {
                            setSliderPosition(sliderPos - 1);
                        }
                        else if (id == "rightstep") {
                            setSliderPosition(sliderPos + 1);
                        }
                        else if (id == "leftstar") {
                            nextStar = 0; // default to first revision in document
                            for (i = 0; i < savedRevisionNums.length; i++) {
                                pos = savedRevisionNums[i];
                                if (pos < sliderPos && nextStar < pos)
                                    nextStar = pos;
                            }
                            setSliderPosition(nextStar);
                        }
                        else if (id == "rightstar") {
                            nextStar = sliderLength; // default to last revision in document
                            for (i = 0; i < savedRevisionNums.length; i++) {
                                pos = savedRevisionNums[i];
                                if (pos > sliderPos && nextStar > pos)
                                    nextStar = pos;
                            }
                            setSliderPosition(nextStar);
                        }
                    });
                    document.addEventListener("mouseup", function onMouseUp(evt2) {
                        stepper.style["background-position"] = origcss;
                        document.removeEventListener("mouseup". onMouseUp);
                        // stepper.removeEventListener("mouseup", onMouseUp);
                    });
                });
            });

            emit("draw");
        }

        /***** Methods *****/

        function disableSelection(element) {
            element.onselectstart = function() {
                return false;
            };
            element.unselectable = "on";
            element.style.MozUserSelect = "none";
            element.style.cursor = "default";
        }

        function cumulativeOffset(element) {
            var top = 0, left = 0;
            do {
                top += element.offsetTop  || 0;
                left += element.offsetLeft || 0;
                element = element.offsetParent;
            } while(element);

            return {
                top: top,
                left: left
            };
        }

        function onBarMouseDown(evt) {
            var newloc = evt.clientX - cumulativeOffset(sliderBar).left;
            var newSliderPos = Math.round(newloc * sliderLength / (sliderBar.offsetWidth - 2));
            handle.style.left = calcHandlerLeft(newSliderPos) + "px";
            onHandleMouseDown(evt);
        }

        function onHandleMouseDown(evt) {
            var startLoc = evt.clientX;
            var currentLoc = parseInt(handle.style.left.split("px")[0], 10);
            sliderActive = true;

            function calcSliderPos(clientX) {
                var newloc = currentLoc + (clientX - startLoc) - LEFT_PADDING;
                if (newloc < 0)
                    newloc = 0;
                var barWidth = sliderBar.offsetWidth - 2;
                if (newloc > barWidth)
                    newloc = barWidth;
                return Math.round(newloc * sliderLength / barWidth);
            }

            function onMouseMove(evt2) {
                handle.style.pointer = "move";
                var newSliderPos = calcSliderPos(evt2.clientX);
                revisionLabel.innerHTML = "Version " + newSliderPos;
                handle.style.left = calcHandlerLeft(newSliderPos) + "px";
                if (sliderPos != newSliderPos) {
                    sliderPos = newSliderPos;
                    emit("slider", newSliderPos);
                }
            }

            function onMouseUp(evt2) {
                document.removeEventListener("mousemove", onMouseMove);
                document.removeEventListener("mouseup", onMouseUp);
                sliderActive = false;
                var newSliderPos = calcSliderPos(evt2.clientX);
                currentLoc = calcHandlerLeft(newSliderPos);
                handle.style.left = currentLoc + "px";
                // if(sliderPos != Math.round(newloc * sliderLength / ($("#ui-slider-bar").width()-2)))
                setSliderPosition(newSliderPos);
            }

            document.addEventListener("mousemove", onMouseMove);
            document.addEventListener("mouseup", onMouseUp);
        }

        var starWidth = 15;
        function updateSliderElements() {
            var prevX, prevStar, firstHidden;
            for (var i = 0; i < savedRevisions.length; i++) {
                var star = savedRevisions[i];
                var position = parseInt(star.pos, 10);
                var x = calcHandlerLeft(position) - 1;
                if (x - prevX < 2 * starWidth) {
                    if (prevStar)
                        prevStar.style.opacity = 0.05;
                    prevStar = star;
                    if (!firstHidden) {
                        firstHidden = x;
                    } else if (x - firstHidden > 5 * starWidth) {
                        firstHidden = prevStar = null;
                    }
                } else {
                    firstHidden = prevStar = null;
                }
                prevX = x;
                star.style.left = x + "px";
                star.style.opacity = 1;
            }
            handle.style.left = calcHandlerLeft(sliderPos) + "px";
        }

        function addSavedRevision(revision) {
            var position = revision.revNum;
            var newSR = document.createElement("div");
            newSR.className = "star";
            newSR.title = "File Saved on " + dateFormat(revision.updated_at);
            newSR.pos = position;
            newSR.style.left = (calcHandlerLeft(position) - 1) + "px";
            slider.appendChild(newSR);
            newSR.addEventListener("mouseup", function() {
                setSliderPosition(position);
            });
            savedRevisions.push(newSR);
            savedRevisionNums.push(position);
            if (position === sliderPos)
                setSliderPosition(position);
        }

        function setSavedRevisions(revisions) {
            toArray(slider.getElementsByClassName("star")).forEach(function (star) {
                star.remove();
            });
            savedRevisions = [];
            savedRevisionNums = [];
            revisions.forEach(function(revision) {
                addSavedRevision(revision);
            });
        }

        function toArray(arg) {
            return Array.prototype.slice.apply(arg);
        }

        function zpad(str, length) {
            str = str + "";
            while (str.length < length)
            str = "0" + str;
            return str;
        }

        function dateFormat(time) {
            var date = new Date(time);
            var month = ["Jan", "Feb", "March", "April", "May", "June", "July", "Aug", "Sept", "Oct", "Nov", "Dec"][date.getMonth()];
            var day = zpad(date.getDate(), 2);
            var year = date.getFullYear();
            var hours = zpad(date.getHours(), 2);
            var minutes = zpad(date.getMinutes(), 2);
            var seconds = zpad(date.getSeconds(), 2);
            return ([month, " ", day, ", ", year, " ", hours, ":", minutes, ":", seconds].join(""));
        }

        function updateTimer(time) {
            revisionDate.innerHTML = dateFormat(time);
        }

        function calcHandlerLeft(pos) {
            var left = pos * (sliderBar.offsetWidth - 2) / (sliderLength * 1.0);
            left = (left || 0) + LEFT_PADDING;
            return left;
        }

        function setSliderPosition(newpos) {
            newpos = Number(newpos);
            if (newpos < 0 || newpos > sliderLength) return;

            handle.style.left = calcHandlerLeft(newpos) + "px";

            if (savedRevisionNums.indexOf(newpos) === -1) {
                revisionLabel.innerHTML = "Version " + newpos;
                revisionLabel.style.color = "";
            }
            else {
                revisionLabel.innerHTML = "Saved Version " + newpos;
                revisionLabel.style.color = "rgb(168, 231, 168)";
            }

            if (newpos === 0)
                leftStep.style.opacity = 0.5;
            else
                leftStep.style.opacity = 1;

            if (newpos == sliderLength)
                rightStep.style.opacity = 0.5;
            else
                rightStep.style.opacity = 1;

            sliderPos = newpos;
            emit("slider", newpos);
        }

        function getSliderLength() {
            return sliderLength;
        }

        function setSliderLength(newlength) {
            sliderLength = newlength;
            updateSliderElements();
        }

        function playButtonUpdater() {
            if (sliderPlaying) {
                if (sliderPos + 1 > sliderLength) {
                    dom.toggleCssClass(playButtonIcon, "pause");
                    sliderPlaying = false;
                    return;
                }
                setSliderPosition(sliderPos + 1);

                setTimeout(playButtonUpdater, 100);
            }
        }

        function playpause() {
            dom.toggleCssClass(playButtonIcon, "pause");

            if (!sliderPlaying) {
                if (sliderPos == sliderLength) setSliderPosition(0);
                sliderPlaying = true;
                playButtonUpdater();
            }
            else {
                sliderPlaying = false;
            }
        }

        function getCodeEditorTab() {
            return $(".codeditorHolder .hsplitbox");
        }

        var isVisible = false;
        var resizeInterval;

        function show() {
            draw();
            container.style.display = "block";
            // getCodeEditorTab().height(editorContainer.outerHeight() - container.outerHeight());

            clearInterval(resizeInterval);
            var oldWidth = timeslider.offsetWidth;
            resizeInterval = setInterval(function () {
                if (timeslider.offsetWidth !== oldWidth) {
                    updateSliderElements();
                    oldWidth = timeslider.offsetWidth;
                }
            }, 100);
            isVisible = true;
            emit("visible", isVisible);
        }

        function hide() {
            draw();
            container.style.display = "none";
            // getCodeEditorTab().height(editorContainer.outerHeight());
            clearInterval(resizeInterval);
            isVisible = false;
            emit("visible", isVisible);
        }

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
            drawn  = false;
        });

        function getTabCollabDocument(tab) {
            return tab.path && tab.document.getSession().session.collabDoc;
        }

        function toggleTimeslider() {
            // var tab = tabs.focussedTab;
            // if (!tab || !tab.path)
            //     return;
            // var doc = getTabCollabDocument(tab);
            var doc = activeDocument;
            if (!doc)
                return;
            var tab = doc.original.tab;
            var aceEditor = tab.editor.ace;
            if (isVisible) {
                hide();
                if (doc && doc.isInited) {
                    doc.updateToRevNum();
                    if (doc.changed)
                        tab.className.add("changed");
                    else
                        tab.className.remove("changed");
                }
                aceEditor.keyBinding.removeKeyboardHandler(timesliderKeyboardHandler);
                aceEditor.setReadOnly(!!c9.readonly);
            }
            else {
                if (!doc || !doc.revisions[0])
                    return;
                // ide.dispatchEvent("track_action", {type: "timeslider"});
                show();
                aceEditor.setReadOnly(true);
                activeDocument = doc;
                aceEditor.keyBinding.addKeyboardHandler(timesliderKeyboardHandler);
                doc.loadTimeslider();
            }
            aceEditor.renderer.onResize(true);
        }

        function timesliderAvailable(editor){
            if (!editor || editor.type !== "ace")
                return false;
            var aceEditor = editor.ace;
            var collabDoc = aceEditor.session.collabDoc;
            return collabDoc && collabDoc.revisions[0];
        }

        function forceHideSlider() {
            var tsVisible = isVisible || settings.getBool(tsVisibleKey);
            if (tsVisible) {
                settings.set(tsVisibleKey, false);
                toggleTimeslider();
            }
        }

        /***** Register and define API *****/

        /**
         * Adds File->New File and File->New Folder menu items as well as the
         * commands for opening a new file as well as an API.
         * @singleton
         **/
        plugin.freezePublicAPI({
            get visible() { return isVisible; },

            get activeDocument() { return activeDocument; },
            set activeDocument(doc) { activeDocument = doc; },

            get sliderLength() { return getSliderLength(); },
            set sliderLength(len) { setSliderLength(len); },
            get sliderPosition() { return sliderPos; },
            set sliderPosition(pos) { setSliderPosition(pos); },
            set timer(time) { updateTimer(time); },
            set savedRevisions(revs) { setSavedRevisions(revs); },

            show: show,
            hide: hide,
            playpause: playpause,
            addSavedRevision: addSavedRevision
        });

        register(null, {
            timeslider: plugin
        });
    }
});
