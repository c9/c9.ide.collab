define(function(require, exports, module) {
    var oop          = require("ace/lib/oop");
    var BaseClass    = require("ace_tree/data_provider");

    function DataProvider(root) {
        BaseClass.call(this, root || {});

        this.rowHeight      = 20;
        this.innerRowHeight = 18;

        Object.defineProperty(this, "loaded", {
            get : function(){ return this.visibleItems.length; }
        });
    }

    oop.inherits(DataProvider, BaseClass);

    (function() {
        this.$sortNodes = false;

        this.getEmptyMessage = function(){
            return "No open files";
        };

        this.setRoot = function(root){
            if (Array.isArray(root))
                root = {items: root};
            this.root = root || {};
            this.visibleItems = [];
            this.open(this.root, true);

            // @TODO Deal with selection
            this._signal("change");
        };

        this.getIconHTML = function (datarow) {
            var access = datarow.access || "r";
            var status = datarow.status || "offline";
            var color = datarow.color || "transparent";

            var html = [
                "<span class='status ", status, "'></span>\n",
                "<span class='collaborator_color' style='background-color: ", color, ";'></span>\n",
                "<span class='access ", access, "'>", access.toUpperCase(), "</span>\n",
                (!this.iAmAdmin || datarow.isAdmin) ? "" : "<span class='access_control'></span>\n"
            ];

            // var className = datarow.access === "r" ? "readonly" : "readwrite";
            // if (className)
            //     html += "<strong class='" + className + "'> </strong>";
            return html.join("");
        };

    }).call(DataProvider.prototype);

    return DataProvider;
});