'use strict';

const argv          = require('yargs').argv;
const fs            = require('co-fs-extra');
const path          = require('path');
const co            = require('co');
const VError        = require('verror');
const sprintf       = require('extsprintf').sprintf;
const Logger        = require('shark-logger');
const Storage       = require('./storage');
const expand        = require('expand');


process.on('uncaughtException', function(error) {
	console.error(sprintf('%r', new VError(error, 'global uncaughtException')));
	process.exit(1);
});

function SharkRunner(options) {
	this.tasks = {};
	this.storage = new Storage();
	this.setStorageValues(options.storageValues);
	this.logger = Logger({
		name: 'SharkRunner',
		level: Logger.TRACE
	});

	var time = this.logger.time().start();
	this.logger.trace('SharkRunner Init');

	process.on('exit', function() {
		this.logger.trace({ duration: time.delta() }, 'SharkRunner finished')
	}.bind(this));
}

SharkRunner.prototype = {
	constructor: SharkRunner,

	getStorageValue: function() {
		//this.logger.trace('getStorageValue', arguments);
		return this.storage.getValue.apply(this.storage, arguments);
	},

	setStorageValue: function() {
		//this.logger.trace('setStorageValue', arguments);
		return this.storage.setValue.apply(this.storage, arguments);
	},

	setStorageValues: function() {
		//this.logger.trace('setStorageValues', arguments);
		return this.storage.setValues.apply(this.storage, arguments);
	},


	collectTasks: function *(tasksPath) {
		var time = this.logger.time().start();
		this.logger.trace('collectTasks', tasksPath);
		try {
			var files = yield expand([
				'./*/*.js',
				'./*/*/*.js'
			], {
				cwd: this.getStorageValue('tasksPath')
			});

			files.filter(function(filePath) {
				var fileName = path.basename(filePath, '.js');
				var dirName = path.basename(path.dirname(filePath));
				var parentDirName = path.basename(path.dirname(path.dirname(filePath)));
				var isTask = fileName === dirName;

				if (isTask) {
					var fullFilePath = path.join(this.getStorageValue('tasksPath'), filePath);
					var taskName;

					if (parentDirName === '.') {
						taskName = fileName;
					}
					else {
						taskName = path.join(parentDirName, fileName);
					}

					this.tasks[taskName] = fullFilePath;
				}
			}.bind(this));
		}
		catch (error) {
			throw new VError(error, 'collectTasks error');
		}
		this.logger.trace({ duration: time.delta() }, 'collectTasks finished');
	},

	runRequestedTasks: function* () {
		var taskName = argv._[0];

		return yield this.runTask(taskName);
	},


	runTask: function *(taskName, options) {
		var tasks = this.tasks;
		if (tasks[taskName]) {
			try {
				var time = this.logger.time().start();
				this.logger.info({
					opType: Logger.OP_TYPE.IMPORTANT,
					block: taskName
				}, 'task started');

				var task = require(tasks[taskName]);
				yield task.call(this, options || {});

				this.logger.info({
					opType: Logger.OP_TYPE.IMPORTANT,
					block: taskName,
					duration: time.delta()
				}, 'task finished')
			}
			catch (error) {
				throw new VError(error, 'runTask "%s" error', taskName);
			}
		}
		else {
			this.logger.warn({
				opType: Logger.OP_TYPE.ERROR,
				block: taskName
			}, 'task "%s" not found"', taskName);
		}
	}
};

module.exports = function(config) {
	if (!config || !config.tasksPath) {
		throw new VError('config.tasksPath not defined');
	}

	var shark = new SharkRunner({
		storageValues: config
	});

	co(function *sharkfileSharkRunner() {
		yield shark.collectTasks(shark.getStorageValue('tasksPath'));
		yield shark.runRequestedTasks();
	}).catch(function(error) {
		console.error(sprintf('%r', new VError(error, 'sharkfileSharkRunner error')));
		process.exit(1);
	});

	return {
		setStorageValue:    shark.setStorageValue.bind(shark),
		getStorageValue:    shark.getStorageValue.bind(shark),
		setStorageValues:   shark.setStorageValues.bind(shark),

		runTask:            shark.runTask.bind(shark)
	};
};