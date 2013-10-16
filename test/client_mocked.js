/*global require module __dirname*/
"use strict";
var NodeModule = require("module");
var path = require("path");

var noop = function(){};
var requireMocks = {};

requireMocks[require.resolve("ext/ot/chat")] = {init: noop};

var mockedCursors = function () {
    this.dispose = noop;
    this.clearSelection = noop;
    this.updateSelection = noop;
    this.updateSelections = noop;
    this.setInsertRight = noop;
    this.hideTooltip = noop;
    this.hideAllTooltips = noop;
    this.showTooltip = noop;
};
mockedCursors.initTooltipEvents = noop;
mockedCursors.selectionToData = noop;

requireMocks[require.resolve("ext/ot/cursors")] = mockedCursors;

var mockedAuthors = function () {
    this.dispose = noop;
    this.refresh = noop;
};
mockedAuthors.initGutterEvents = noop;
mockedAuthors.setEnabled = noop;

requireMocks[require.resolve("ext/ot/authors_layer.js")] = mockedAuthors;

requireMocks[require.resolve("ext/ot/timeslider.js")] = {
        init: noop,
        isVisible: noop // false
};

var requireLoad = NodeModule._load;
NodeModule._load = function(request) {
    return requireMocks[request] || requireLoad.apply(NodeModule, arguments);
};

module.exports = require("./client");
