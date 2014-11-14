'use strict';

function Storage() {
	this.storage = {};
}

Storage.prototype = {
	constructor: Storage,
	setValue: function(key, value) {
		this.storage[key] = value;
	},

	setValues: function(hash) {
		for (let key in hash) {
			if (hash.hasOwnProperty(key)) {
				this.setValue(key, hash[key]);
			}
		}
	},

	getValue: function(key) {
		return this.storage[key];
	}
};

module.exports = Storage;