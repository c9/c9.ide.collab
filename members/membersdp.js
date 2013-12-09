define(function(require, exports, module) {
    var oop          = require("ace/lib/oop");
    var BaseClass    = require("ace_tree/data_provider");

    function DataProvider(root) {
        BaseClass.call(this, root || {});

        this.rowHeight      = 37;
        this.rowHeightInner = 35;

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

        this.getContentHTML = function (datarow) {
            if (!datarow.uid)
                return "<span class='root caption'>" + datarow.name + "</span>";
            var access = datarow.acl || "r";
            var canAccessControl = this.iAmAdmin && !datarow.isAdmin;
            var disabledLabel = access == "r" ? "<div class='readbutton'>R</div>" : "<div class='writebutton'>RW</div>";
            var status = datarow.status || "offline";
            var color = datarow.color || "transparent";

            var defaultImgUrl = encodeURIComponent("http://www.aiga.org/uploadedImages/AIGA/Content/About_AIGA/Become_a_member/generic_avatar_300.gif");
            var avatarImg = '<img class="gravatar-image" src="https://secure.gravatar.com/avatar/' +
                datarow.md5Email + '?s=38&d='  + defaultImgUrl + '" />';

            var html = [
                "<span class='caption'>" + datarow.name + "</span>\n",
                "<span class='avatar'>" + avatarImg + "</span>\n",
                "<span class='status ", status, "'></span>\n",
                "<span class='collaborator_color' style='background-color: ", color, ";'></span>\n",
                 canAccessControl ?
                    ("<div class='access_control "  + access  + "'>" +
                        "<div class='readbutton'>R</div>" +
                        "<div class='writebutton'>RW</div></div>" +
                    "<div class='kickout'></div>\n") :
                    ("<div class='access_control disabled'>" + disabledLabel + "</div>\n"),
            ];

            return html.join("");
        };

    }).call(DataProvider.prototype);

    return DataProvider;
});