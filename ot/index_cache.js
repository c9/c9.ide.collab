/**
 * very simple and dumb cache to test impact on ot performance
 */
define(function(require, exports, module) {
"use strict";

function IndexCache(doc) {
    if (doc.indexToPositionSlow) return;

    doc.icache = [];
    doc.rcache = [];

    doc.on("change", function(e) {
        var row = e.data.range.start.row;
        doc.icache.splice(row, doc.icache.length);
        for (var i = doc.rcache.length; i--;) {
            if (doc.rcache[i].row >= row)
                doc.rcache.splice(i, 1);
        }
    }, true);
    doc.on("changeNewLineMode", function(e) {
        doc.icache = [];
        doc.rcache = [];
    });

    doc.indexToPositionSlow = doc.indexToPosition;
    doc.indexToPosition = function(index, startRow) {
        if (startRow) return doc.indexToPositionSlow(index, startRow);
        
        var startIndex = 0;
        startRow = 0;
        var rcache = doc.rcache;
        for (var i = rcache.length; i--;) {
            if (rcache[i].index <= index && doc.rcache[i].row > startRow) {
                startRow = rcache[i].row;
                startIndex = rcache[i].index;
            }
        }
        
        var pos = doc.indexToPositionSlow(index - startIndex, startRow);
        //console.log(pos, doc.indexToPositionSlow(index))
        if (startRow - pos.row > 10)
            rcache.push({row: pos.row, index: index-pos.column});
        
        if (rcache.length > 20)
            rcache.unshift();
            
        return pos;
    };
    doc.positionToIndexSlow = doc.positionToIndex;
    doc.positionToIndex = function(pos, startRow) {
        if (startRow) return doc.positionToIndexSlow(pos, startRow);
        /* if (this.rowToIndex(pos.row) + pos.column != doc.positionToIndexSlow(pos, startRow))
            debugger */
        return this.rowToIndex(pos.row) + pos.column;
    };
    doc.rowToIndex = function(row) {
        var lines = this.$lines || this.getAllLines();
        var newlineLength = this.getNewLineCharacter().length;
        var index = 0;
        var icache = this.icache;
        row = Math.min(row, lines.length);
        for (var i = row-1; i >= 0; i--) {
            if (icache[i]) {
                index+=icache[i];
                break;
            }
            index += lines[i].length + newlineLength;
        }
        if (row > 0)icache[row-1] = index;
        /* if (index + pos.column != doc.positionToIndexSlow(pos, startRow))
            debugger */
        return index;
    };
}

module.exports = IndexCache;
});
