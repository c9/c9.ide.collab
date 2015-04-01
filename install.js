define(function(require, exports, module) {
    
module.exports = function(session, options){
    session.install({
        "name": "collab-deps",
        "description": "Dependencies for the collaboration features of Cloud9",
        "cwd": "~/.c9",
        "optional": true
    }, [
        {
            "npm": ["sqlite3@2.1.18", "sequelize@2.0.0-beta.0"]
        },
        {
            "tar.gz": [
                {
                    "url": "https://raw.githubusercontent.com/c9/install/master/packages/sqlite3/linux/sqlite3.tar.gz",
                    "target": "~/.c9/lib/sqlite3"
                },
                { 
                    "url": "https://raw.githubusercontent.com/c9/install/master/packages/extend/c9-vfs-extend.tar.gz",
                    "target": "~/.c9/c9-vfs-extend"
                }
            ]
        },
        {
            "symlink": {
                "source": "~/.c9/lib/sqlite3/sqlite3",
                "target": "~/.c9/bin/sqlite3"
            }
        }
    ]);

    // Show the installation screen
    session.start();
};

});