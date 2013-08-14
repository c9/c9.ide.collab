module.exports = function (vfs, register) { 
    register(null, { 
        connect: function (arg, callback) {
            var stream = null;
            callback(null, stream);
        }
    });
};