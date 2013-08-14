/*global describe it before after  =*/

require(["lib/architect/architect", "lib/chai/chai"], function (architect, chai) {
    var expect = chai.expect;
    var Assert = chai.assert;
    
    architect.resolveConfig([
        {
            packagePath : "plugins/c9.core/c9",
            workspaceId : "ubuntu/ip-10-35-77-180",
            startdate   : new Date(),
            debug       : true,
            smithIo     : "{\"prefix\":\"/smith.io/server\"}",
            hosted      : true,
            local       : false,
            davPrefix   : "/"
        },
        
        "plugins/c9.core/ext",
        "plugins/c9.core/events",
        "plugins/c9.core/http",
        "plugins/c9.core/util",
        "plugins/c9.ide.ui/lib_apf",
        "plugins/c9.ide.ui/ui",
        "plugins/c9.core/settings",
        {
            packagePath  : "plugins/c9.collab/collab"
        },
        "plugins/c9.fs/vfs",
        "plugins/c9.fs/fs",
        
        // Mock plugins
        {
            consumes : ["emitter", "ui"],
            provides : [
                "preferences"
            ],
            setup    : expect.html.mocked
        },
        {
            consumes : ["collab"],
            provides : [],
            setup    : main
        }
    ], function (err, config) {
        if (err) throw err;
        var app = architect.createApp(config);
        app.on("service", function(name, plugin){ plugin.name = name; });
    });
    
    function main(options, imports, register) {
        var collab   = imports.collab;
        
        describe('collab', function() {
            this.timeout(10000);
            
            describe("connect", function(){
                it('should connect', function(done) {
                    collab.connect(null, function(err, stream){
                        if (err) throw err.message;
                    });
                });
            });
        });
        
        if (onload)
            onload();
    }
});