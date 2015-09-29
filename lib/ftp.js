var JSFtp = require("jsftp");
    JSFtp = require('jsftp-mkdirp')(JSFtp);

var ftp = {
	init: function(conf){
		return new JSFtp(conf);
	}
}

module.exports = ftp;