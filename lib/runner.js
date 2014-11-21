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
		level: Logger.TRACE,
		deepLevel: 1
	});

	var time = this.logger.time().start();
	this.logger.trace({ opType: this.logger.OP_TYPE.STARTED }, 'SharkRunner');

	process.on('exit', function() {
		this.logger.trace({
			duration: time.delta(),
			opType: this.logger.OP_TYPE.FINISHED
		}, 'SharkRunner')
	}.bind(this));
}

SharkRunner.prototype = {
	constructor: SharkRunner,

	getStorageValue: function() {
		return this.storage.getValue.apply(this.storage, arguments);
	},

	setStorageValue: function() {
		return this.storage.setValue.apply(this.storage, arguments);
	},

	setStorageValues: function() {
		return this.storage.setValues.apply(this.storage, arguments);
	},


	collectTasks: function *(tasksPath) {
		var time = this.logger.time().start();
		this.logger.trace({ opType: this.logger.OP_TYPE.STARTED }, 'collectTasks', tasksPath);
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
		this.logger.trace({ duration: time.delta(), opType: this.logger.OP_TYPE.FINISHED }, 'collectTasks');
	},

	runRequestedTasks: function* () {
		var taskName = argv._[0];

		return yield this.runTask(taskName, this.logger.fields.deepLevel, {});
	},

	runTask: function *(taskName, deepLevel, options) {
		var taskPath = this.tasks[taskName];
		if (!taskPath) {
			this.logger.warn({
				opType: Logger.OP_TYPE.ERROR,
				opName: taskName
			}, 'task "%s" not found', taskName);
		}

		var time = this.logger.time().start();

		this.logger.info({
			opType: Logger.OP_TYPE.STARTED,
			opName: taskName,
			deepLevel: deepLevel
		});

		try {
			var taskRunner = require(taskPath);
			var taskRunnerResult = yield taskRunner.call(
				this.getTaskInternalMethods.apply(this, arguments)
			);
		}
		catch (error) {
			throw new VError(error, 'runTask error');
		}

		this.logger.info({
			opType: Logger.OP_TYPE.FINISHED,
			opName: taskName,
			duration: time.delta(),
			deepLevel: deepLevel
		});

		return taskRunnerResult;
	},

	getTaskInternalMethods: function(taskName, deepLevel, options) {
		return {
			taskDeepLevel: deepLevel,
			options: options || {},
			logger: deepLevel === 1 ? this.logger : this.logger.child({
				subName: taskName,
				deepLevel: deepLevel + 1
			}),
			runTask: function *(taskName, options) {
				try {
					return yield this.runTask(taskName, deepLevel, options);
				}
				catch (error) {
					throw new VError(error, 'runner#getTaskInternalMethods runTask error');
				}
			}.bind(this),
			runChildTask: function *(taskName, options) {
				try {
					return yield this.runTask(taskName, deepLevel + 1, options);
				}
				catch (error) {
					throw new VError(error, 'runner#getTaskInternalMethods runChildTask error');
				}
			}.bind(this)
		};
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
