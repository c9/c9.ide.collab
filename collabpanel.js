define(function(require, module, exports) {
    main.consumes = ["Plugin", "ui", "collab"];
    main.provides = ["CollabPanel"];
    return main;

    function main(options, imports, register) {
        var Plugin    = imports.Plugin;
        var ui        = imports.ui;
        var collab    = imports.collab;

        function CollabPanel(developer, deps, options){
            // Editor extends ext.Plugin
            var plugin = new Plugin(developer, deps);
            var emit   = plugin.getEmitter();
            emit.setMaxListeners(1000);

            var caption = options.caption;
            var index   = options.index || 100;
            var amlFrame;

            plugin.on("load", function(){
                // Draw panel when collab panel is drawn
                collab.on("drawPanels", draw, plugin);
            });

            function draw(e){
                amlFrame = ui.frame({
                    htmlNode    : e.html,
                    buttons     : "min",
                    activetitle : "min",
                    caption     : caption
                });
                ui.insertByIndex(e.html, amlFrame.$ext, index, false);
                plugin.addElement(amlFrame);

                emit("draw", { aml: amlFrame, html: amlFrame.$int }, true);
            }

            /***** Methods *****/

            function show(){
                draw();
                amlFrame.show();
            }

            function hide(){
                amlFrame.hide();
            }

            /***** Register and define API *****/

            plugin.freezePublicAPI.baseclass();

            /**
             * Collab panel base class for the {@link collab}.
             *
             * A collab panel is a section of the collab that allows users to
             * collaborate on a workspace
             *
             * @class CollabPanel
             * @extends Plugin
             */
            /**
             * @constructor
             * Creates a new CollabPanel instance.
             * @param {String}   developer   The name of the developer of the plugin
             * @param {String[]} deps        A list of dependencies for this
             *   plugin. In most cases it's a reference to `main.consumes`.
             * @param {Object}   options     The options for the collab panel
             * @param {String}   options.caption  The caption of the frame.
             */
            plugin.freezePublicAPI({
                /**
                 * The APF UI element that is presenting the pane in the UI.
                 * This property is here for internal reasons only. *Do not
                 * depend on this property in your plugin.*
                 * @property {AMLElement} aml
                 * @private
                 * @readonly
                 */
                get aml(){ return amlFrame; },

                _events : [
                    /**
                     * Fired when the panel container is drawn.
                     * @event draw
                     * @param {Object}      e
                     * @param {HTMLElement} e.html  The html container.
                     * @param {AMLElement}  e.aml   The aml container.
                     */
                    "draw"
                ],

                /**
                 * Shows the panel.
                 */
                show : show,

                /**
                 * Hides the panel.
                 */
                hide : hide
            });

            return plugin;
        }

        /***** Register and define API *****/

        register(null, {
            CollabPanel: CollabPanel
        });
    }
});