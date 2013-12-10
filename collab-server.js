module.exports = function (vfs, options, register) { 
    register(null, { 
        connect: function (arg, callback) {
            var stream = null;
            callback(null, stream);
        }
    });
};