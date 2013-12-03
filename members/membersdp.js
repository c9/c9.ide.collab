define(function(require, exports, module) {
    var oop          = require("ace/lib/oop");
    var BaseClass    = require("ace_tree/data_provider");

    function DataProvider(root) {
        BaseClass.call(this, root || {});

        this.rowHeight      = 40;
        this.rowHeightInner = 38;

        Object.defineProperty(this, "loaded", {
            get : function(){ return this.visibleItems.length; }
        });
    }

    oop.inherits(DataProvider, BaseClass);

    (function() {
        this.$sortNodes = false;

        this.getEmptyMessage = function(){
            return "Loading Members ...";
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

        this.getCaptionHtml = function (datarow) {
            if (datarow.uid)
                return datarow.name;
            else
                return "<span class='member_name'>" + datarow.name + "</span>";
        };

        this.getIconHTML = function (datarow) {
            if (!datarow.uid)
                return "";
            var access = datarow.acl || "r";
            var status = datarow.status || "offline";
            var color = datarow.color || "transparent";

            var defaultImgUrl = encodeURIComponent("/static/plugins/c9.ide.collab/members/images/room_collaborator_default-white.png");
            var avatarImg = '<img class="gravatar-image" src="https://secure.gravatar.com/avatar/' +
                datarow.md5Email + '?s=38&d='  + defaultImgUrl + '" />';

            var html = [
                "<span class='avatar'>" + avatarImg + "</span>\n",
                "<span class='status ", status, "'></span>\n",
                "<span class='collaborator_color' style='background-color: ", color, ";'></span>\n",
                "<span class='access_menu'>",
                "<span class='access ", access, "'>", access.toUpperCase(), "</span>\n",
                (!this.iAmAdmin || datarow.isAdmin) ? "" : "<span class='access_control'></span>\n",
                "</span>",
            ];

            return html.join("");
        };

    }).call(DataProvider.prototype);

    return DataProvider;
});