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
const chokidar      = require('chokidar');
const util          = require('util');


process.on('uncaughtException', function(error) {
	console.error(sprintf('%r', new VError(error, 'global uncaughtException')));
	process.exit(1);
});

function SharkRunner(options) {
	this.tasks = {};
	this.wasTasksCollected = false;
	this.isWatcherRunning = false;
	this.storage = new Storage();
	this.setStorageValues(options.storageValues);
	this.logger = Logger({
		name: 'SharkRunner',
		level: process.argv[2] === 'completion' ? 100 : Logger.TRACE,
		deepLevel: 1
	});

	var time = this.logger.time();
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


	collectTasksByDirPath: function *(tasksPath) {
		var time = this.logger.time();
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
			throw new VError(error, 'collectTasksByDirPath error');
		}
		this.logger.trace({ duration: time.delta(), opType: this.logger.OP_TYPE.FINISHED }, 'collectTasksByDirPath');
	},

	collectTasks: function *() {
		if (!this.wasTasksCollected) {
			yield this.collectTasksByDirPath(this.getStorageValue('tasksPath'));
			this.wasTasksCollected = true;
		}
	},

	getTaskList: function *() {
		yield this.collectTasks();
		return this.tasks;
	},

	runRequestedTasks: function* () {
		yield this.collectTasks();

		var taskName = argv._[0];

		return yield this.runTask(taskName, this.logger.fields.deepLevel, {});
	},

	runTask: function *(taskName, deepLevel, options) {
		yield this.collectTasks();

		var taskPath = this.tasks[taskName];
		if (!taskPath) {
			this.logger.warn({
				opType: Logger.OP_TYPE.ERROR,
				opName: taskName
			}, 'task "%s" not found', taskName);
			return;
		}

		var time = this.logger.time();

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
			getStorageValue: this.getStorageValue.bind(this),
			taskDeepLevel: deepLevel,
			options: options || {},
			logger: this.logger.child({
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
	},

	runWatcher: function *() {
		if (this.isWatcherRunning) {
			this.logger.trace('Watcher already run');
			return;
		}

		this.isWatcherRunning = true;

		var tasksPath = this.getStorageValue('tasksPath');

		var files = yield expand([
			'./*/watcher.js',
			'./*/*/watcher.js'
		]
			.map(function(filePath) {
				return path.join(this.getStorageValue('tasksPath'), filePath)
			}, this)
		);

		for (var i = 0, len = files.length; i < len; i += 1) {
			var watcherDataGetter = require(files[i]);
			var watcherData = yield watcherDataGetter.call(
				this.getTaskInternalMethods.apply(this, arguments)
			);

			if (!util.isArray(watcherData.paths)) {
				throw new VError(files[i] + ' watcherData.paths must be array')
			}

			if (!util.isObject(watcherData.events)) {
				throw new VError(files[i] + ' watcherData.event must be object')
			}

			var watcher = chokidar.watch(watcherData.paths, {ignored: /[\/\\]\./, persistent: true});

			(function(watcherData, watcherPath) {
				Object.keys(watcherData.events).forEach(function(eventName) {
					var eventCallback = watcherData.events[eventName];

					this.logger.info('running watcher', watcherPath);
					watcher.on(eventName, function() {
						var args = [].slice.call(arguments);
						co(function *() {
							yield eventCallback.apply(this, args);
						}).catch(function(error) {
							console.error(sprintf('%r', error));
						});
					}.bind(this));
				}, this);
			}).call(this, watcherData, files[i]);
		}
	},

	watchRequested: function() {
		return !!argv.watch;
	}
};

module.exports = function(config) {
	if (!config || !config.tasksPath) {
		throw new VError('config.tasksPath not defined');
	}

	var shark = new SharkRunner({
		storageValues: config
	});

	var errorHandler = function(error) {
		console.error(sprintf('%r', error));
		process.exit(1);
	};

	var promisify = function(genFunc, thisArg) {
		return function() {
			var args = [].slice.call(arguments, 0);
			return new Promise(function(fulfill, reject) {
				co(function *() {
					var result = yield genFunc.apply(thisArg, args);
					fulfill(result);
				}).catch(function(error) {
					reject(error);
				});
			});
		};
	};

	return {
		setStorageValue:    shark.setStorageValue.bind(shark),
		getStorageValue:    shark.getStorageValue.bind(shark),
		setStorageValues:   shark.setStorageValues.bind(shark),

		runTask:            promisify(shark.runTask, shark),
		runRequestedTask:   promisify(shark.runRequestedTask, shark),

		getTaskList:        promisify(shark.getTaskList, shark),

		runWatcher:         promisify(shark.runWatcher, shark),

		run: function() {
			co(function *sharkfileSharkRunner() {
				yield shark.runRequestedTasks();
				if (shark.watchRequested()) {
					yield shark.runWatcher();
				}
			}).catch(errorHandler);
		}
	};
};
