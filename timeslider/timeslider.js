/*global document window setTimeout */
define(function(require, exports, module) {
    "use strict";
    
    main.consumes = ["Plugin", "c9", "ui", "jQuery"];
    main.provides = ["timeslider"];
    return main;

    function main(options, imports, register) {
        var Plugin       = imports.Plugin;
        var c9           = imports.c9;
        var ui           = imports.ui;

        var jQuery       = imports.jQuery.$;

        var html         = require("text!./timeslider.html");
        var css          = require("text!./timeslider.css");
        var staticPrefix = options.staticPrefix;

        // ui elements
        var timesliderClose;

        /***** Initialization *****/

        var plugin   = new Plugin("Ajax.org", main.consumes);
        var emit     = plugin.getEmitter();

        var sliderLength      = 1000;
        var sliderPos         = 0;
        var sliderActive      = false;
        var slidercallbacks   = [];
        var savedRevisions    = [];
        var savedRevisionNums = [];
        var sliderPlaying     = false;
        // This number is calibrated from UI experimentation
        var LEFT_PADDING      = 59;

        var loaded   = false;
        function load(callback){
            if (loaded) return false;
            loaded = true;
        }

        var drawn = false;
        function draw () {
            if (drawn) return;
            drawn = true;

            ui.insertHtml(null, html, plugin);
            ui.insertCss(css, staticPrefix, plugin);

            timesliderClose    = plugin.getElement("timesliderClose");

            timesliderClose.on("click", function() {
                forceHideSlider();
            });

            var codeCt = getCodeEditorConiatner();
            var tsCt = getTimeSliderContainer();
            codeCt.prepend(tsCt);

            disableSelection(jQuery("#playpause_button")[0]);
            disableSelection(jQuery("#timeslider")[0]);

            jQuery(window).resize(function() {
                updateSliderElements();
            });

            jQuery("#timeslider-slider").mousedown(function(evt) {
                if (evt.target.className == "star" && !sliderActive)
                    jQuery("#ui-slider-bar").trigger(evt);
            });
            
            jQuery("#ui-slider-bar").mousedown(function(evt) {
                var newloc = evt.clientX - jQuery("#ui-slider-bar").offset().left;
                var newSliderPos = Math.round(newloc * sliderLength / (jQuery("#ui-slider-bar").width() - 2));
                jQuery("#ui-slider-handle").css('left', calcHandlerLeft(newSliderPos));
                jQuery("#ui-slider-handle").trigger(evt);
            });

            // Slider dragging
            jQuery("#ui-slider-handle").mousedown(function(evt) {
                this.startLoc = evt.clientX;
                this.currentLoc = parseInt(jQuery(this).css('left'), 10);
                var _self = this;
                sliderActive = true;
                jQuery(document).mousemove(function(evt2) {
                    jQuery(_self).css('pointer', 'move');
                    var newloc = _self.currentLoc + (evt2.clientX - _self.startLoc) - LEFT_PADDING;
                    if (newloc < 0) newloc = 0;
                    if (newloc > (jQuery("#ui-slider-bar").width() - 2)) newloc = (jQuery("#ui-slider-bar").width() - 2);
                    var newSliderPos = Math.round(newloc * sliderLength / (jQuery("#ui-slider-bar").width() - 2));
                    jQuery("#revision_label").html("Version " + newSliderPos);
                    jQuery(_self).css('left', calcHandlerLeft(newSliderPos));
                    if (getSliderPosition() != newSliderPos)
                        _callSliderCallbacks(newSliderPos);
                });
                jQuery(document).mouseup(function(evt2) {
                    jQuery(document).unbind('mousemove');
                    jQuery(document).unbind('mouseup');
                    sliderActive = false;
                    var newloc = _self.currentLoc + (evt2.clientX - _self.startLoc) + - LEFT_PADDING;
                    if (newloc < 0)
                        newloc = 0;
                    if (newloc > (jQuery("#ui-slider-bar").width() - 2))
                        newloc = (jQuery("#ui-slider-bar").width() - 2);
                    var newSliderPos = Math.round(newloc * sliderLength / (jQuery("#ui-slider-bar").width() - 2));
                    jQuery(_self).css('left', calcHandlerLeft(newSliderPos));
                    // if(getSliderPosition() != Math.round(newloc * sliderLength / (jQuery("#ui-slider-bar").width()-2)))
                    setSliderPosition(newSliderPos);
                    _self.currentLoc = parseInt(jQuery(_self).css('left'), 10);
                });
            });

            // play/pause toggling
            jQuery("#playpause_button").mousedown(function(evt) {
                var _self = this;
                var staticPrefix = window.cloud9config.staticUrl + "/ext/ot/style";

                jQuery(_self).css('background-image', 'url('+ staticPrefix + '/play_depressed.png)');
                jQuery(_self).mouseup(function(evt2) {
                    jQuery(_self).css('background-image', 'url(' + staticPrefix + '/play_undepressed.png)');
                    jQuery(_self).unbind('mouseup');
                    BroadcastSlider.playpause();
                });
                jQuery(document).mouseup(function(evt2) {
                    jQuery(_self).css('background-image', 'url(' + staticPrefix + '/play_undepressed.png)');
                    jQuery(document).unbind('mouseup');
                });
            });

            // next/prev saved revision and changeset
            jQuery('.stepper').mousedown(function(evt) {
                var _self = this;
                var origcss = jQuery(_self).css('background-position');
                if (!origcss)
                    origcss = jQuery(_self).css('background-position-x') + " " + jQuery(_self).css('background-position-y');
                var origpos = parseInt(origcss.split(" ")[1], 10);
                var newpos = (origpos - 43);
                if (newpos < 0) newpos += 87;

                var newcss = (origcss.split(" ")[0] + " " + newpos + "px");
                if (jQuery(_self).css('opacity') != 1.0) newcss = origcss;

                jQuery(_self).css('background-position', newcss);

                var pos, nextStar, i;

                jQuery(_self).mouseup(function(evt2) {
                    jQuery(_self).css('background-position', origcss);
                    jQuery(_self).unbind('mouseup');
                    jQuery(document).unbind('mouseup');
                    if (jQuery(_self).attr("id") == ("leftstep")) {
                        setSliderPosition(getSliderPosition() - 1);
                    }
                    else if (jQuery(_self).attr("id") == ("rightstep")) {
                        setSliderPosition(getSliderPosition() + 1);
                    }
                    else if (jQuery(_self).attr("id") == ("leftstar")) {
                        nextStar = 0; // default to first revision in document
                        for (i = 0; i < savedRevisions.length; i++) {
                            pos = parseInt(savedRevisions[i].attr('pos'), 10);
                            if (pos < getSliderPosition() && nextStar < pos) nextStar = pos;
                        }
                        setSliderPosition(nextStar);
                    }
                    else if (jQuery(_self).attr("id") == ("rightstar")) {
                        nextStar = sliderLength; // default to last revision in document
                        for (i = 0; i < savedRevisions.length; i++) {
                            pos = parseInt(savedRevisions[i].attr('pos'), 10);
                            if (pos > getSliderPosition() && nextStar > pos) nextStar = pos;
                        }
                        setSliderPosition(nextStar);
                    }
                });
                jQuery(document).mouseup(function(evt2) {
                    jQuery(_self).css('background-position', origcss);
                    jQuery(_self).unbind('mouseup');
                    jQuery(document).unbind('mouseup');
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

        function _callSliderCallbacks(newval) {
            sliderPos = newval;
            for (var i = 0; i < slidercallbacks.length; i++)
                slidercallbacks[i](newval);
        }

        var starWidth = null;
        function updateSliderElements() {
            var prevX, prevStar, firstHidden;
            if (!starWidth && savedRevisions[0])
                starWidth = savedRevisions[0].width();
            for (var i = 0; i < savedRevisions.length; i++) {
                var star = savedRevisions[i];
                var position = parseInt(star.attr('pos'), 10);
                var x = calcHandlerLeft(position) - 1;
                if (x - prevX < 2 * starWidth) {
                    if (prevStar)
                        prevStar.css("opacity", 0.05);
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
                star.css('left', x).css("opacity", 1);
            }
            jQuery("#ui-slider-handle").css('left', calcHandlerLeft(sliderPos));
        }

        function addSavedRevision(revision) {
            var position = revision.revNum;
            var newSavedRevision = jQuery('<div></div>')
                .addClass("star")
                .attr("title", "File Saved on " + dateFormat(revision.updated_at))
                .attr('pos', position)
                .css('position', 'absolute')
                .css('left', calcHandlerLeft(position) - 1)
                .appendTo(jQuery("#timeslider-slider"))
                .mouseup(function(evt) {
                    BroadcastSlider.setSliderPosition(position);
                });
            savedRevisions.push(newSavedRevision);
            savedRevisionNums.push(position);
            if (position === sliderPos)
                setSliderPosition(position);
        }

        function setSavedRevisions(revisions) {
            jQuery("#timeslider-slider .star").remove();
            savedRevisions = [];
            savedRevisionNums = [];
            revisions.forEach(function(revision) {
                addSavedRevision(revision);
            });
        }

        function removeSavedRevision(position) {
            var element = jQuery("div.star [pos=" + position + "]");
            savedRevisions.remove(element);
            savedRevisionNums.splice(savedRevisionNums.indexOf(position), 1);
            element.remove();
            return element;
        }

        function zpad(str, length) {
            str = str + "";
            while (str.length < length)
            str = '0' + str;
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
            return ([month, ' ', day, ', ', year, ' ', hours, ':', minutes, ':', seconds].join(""));
        }

        function updateTimer(time) {
            jQuery('#revision_date').html(dateFormat(time));
        }

        function onSlider(callback) {
            slidercallbacks.push(callback);
        }

        function getSliderPosition() {
            return sliderPos;
        }

        function calcHandlerLeft(pos) {
            var left = pos * (jQuery("#ui-slider-bar").width() - 2) / (sliderLength * 1.0);
            left = (left || 0) + LEFT_PADDING;
            return left;
        }

        function setSliderPosition(newpos) {
            newpos = Number(newpos);
            if (newpos < 0 || newpos > sliderLength) return;

            jQuery("#ui-slider-handle").css('left', calcHandlerLeft(newpos));

            var revLabel = jQuery("#revision_label");
            if (savedRevisionNums.indexOf(newpos) === -1)
                revLabel.html("Version " + newpos).css("color", "");
            else
                revLabel.html("Saved Version " + newpos).css("color", "green");

            if (newpos === 0) {
                jQuery("#leftstar").css('opacity', 0.5);
                jQuery("#leftstep").css('opacity', 0.5);
            }
            else {
                jQuery("#leftstar").css('opacity', 1);
                jQuery("#leftstep").css('opacity', 1);
            }

            if (newpos == sliderLength) {
                jQuery("#rightstar").css('opacity', 0.5);
                jQuery("#rightstep").css('opacity', 0.5);
            }
            else {
                jQuery("#rightstar").css('opacity', 1);
                jQuery("#rightstep").css('opacity', 1);
            }

            sliderPos = newpos;
            _callSliderCallbacks(newpos);
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
                if (getSliderPosition() + 1 > sliderLength) {
                    jQuery("#playpause_button_icon").toggleClass('pause');
                    sliderPlaying = false;
                    return;
                }
                setSliderPosition(getSliderPosition() + 1);

                setTimeout(playButtonUpdater, 100);
            }
        }

        function playpause() {
            jQuery("#playpause_button_icon").toggleClass('pause');

            if (!sliderPlaying) {
                if (getSliderPosition() == sliderLength) setSliderPosition(0);
                sliderPlaying = true;
                playButtonUpdater();
            }
            else {
                sliderPlaying = false;
            }
        }

        function getTimeSliderContainer() {
            return jQuery("#timeslider-top");
        }

        function getCodeEditorConiatner() {
            return jQuery(".codeditorHolder");
        }

        function getCodeEditorTab() {
            return jQuery(".codeditorHolder .editor_tab");
        }

        var isVisible = false;
        var resizeInterval;

        function show() {
            getTimeSliderContainer().show();
            getCodeEditorTab().height(getCodeEditorConiatner().outerHeight() - getTimeSliderContainer().outerHeight());

            clearInterval(resizeInterval);
            var ts = jQuery("#timeslider");
            var oldWidth = ts.outerWidth();
            resizeInterval = setInterval(function () {
                if (ts.outerWidth() !== oldWidth) {
                    updateSliderElements();
                    oldWidth = ts.outerWidth();
                }
            }, 100);
            isVisible = true;
            emit("visible", isVisible);
        }

        function hide() {
            getTimeSliderContainer().hide();
            getCodeEditorTab().height(getCodeEditorConiatner().outerHeight());
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

        /***** Register and define API *****/

        /**
         * Adds File->New File and File->New Folder menu items as well as the
         * commands for opening a new file as well as an API.
         * @singleton
         **/
        plugin.freezePublicAPI({
            get visible() { return isVisible; },
            get sliderLength() { return getSliderLength(); },
            set sliderLength(len) { setSliderLength(len); },
            get sliderPosition() { return getSliderPosition(); },
            set sliderPosition(pos) { setSliderPosition(pos); },
            set timer(time) { updateTimer(time); },
            set savedRevisions(revs) { setSavedRevisions(revs); },

            show: show,
            hide: hide,
            playpause: playpause,
            addSavedRevision: addSavedRevision,
            onSlider: onSlider,
        });

        register(null, {
            timeslider: plugin
        });
    }
});
