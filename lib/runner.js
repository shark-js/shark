'use strict';

const argv          = require('yargs').argv;
const fs            = require('co-fs-extra');
const path          = require('path');
const co            = require('co');
const VError        = require('verror');
const sprintf       = require('extsprintf').sprintf;
const Logger        = require('shark-logger');
const Storage       = require('./storage');
const expand        = require('expand-promise');
const extend        = require('node.extend');
const chokidar      = require('chokidar');
const util          = require('util');
const changeCase    = require('change-case');


process.on('uncaughtException', function(error) {
	console.error(sprintf('%r', new VError(error, 'global uncaughtException')));
	process.exit(1);
});

function SharkRunner(options) {
	this.tasks = {};
	this.wasTasksCollected = false;
	this.isWatcherRunning = false;
	this.storage = new Storage();
	this.userInputValues = new Storage();
	this.setStorageValues(options.storageValues);
	var logLevel = typeof this.getStorageValue('logLevel') !== 'undefined' ? this.getStorageValue('logLevel') : Logger.INFO;
	if (process.argv[2] === 'completion') {
		logLevel = 100;
	}
	this.logger = Logger({
		name: 'SharkRunner',
		level: logLevel,
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

	setUserInputValue: function(key, value) {
		this.userInputValues.setValue(changeCase.camelCase(key), value);
	},

	getUserInputValue: function(key) {
		var value = this.userInputValues.getValue(changeCase.camelCase(key));
		if (typeof value === 'undefined') {
			return argv[key];
		}
		else {
			return value;
		}
	},

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

	runRequestedTask: function* () {
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
			getUserInputValue: this.getUserInputValue.bind(this),
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
			}.bind(this),
			isWatcherRunning: function() {
				return this.isWatcherRunning;
			}.bind(this)
		};
	},

	runWatcher: function *() {
		if (this.isWatcherRunning) {
			this.logger.info('Watcher already run');
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

		var watcherConfig = this.getStorageValue('watcher') || {};

		for (var i = 0, len = files.length; i < len; i += 1) {
			var watcherDataGetter = require(files[i]);
			var watcherData = yield watcherDataGetter.call(
				this.getTaskInternalMethods(this.getWatcherNameByPath(files[i]), this.logger.getDeepLevel())
			);

			if (!util.isArray(watcherData.paths)) {
				throw new VError(files[i] + ' watcherData.paths must be array')
			}

			if (!util.isObject(watcherData.events)) {
				throw new VError(files[i] + ' watcherData.event must be object')
			}

			var watcher = chokidar.watch(watcherData.paths, extend({}, {
				ignored: /[\/\\]\./,
				persistent: true,
				usePolling: true
			}, watcherConfig));

			(function(watcherData, watcherPath) {
				Object.keys(watcherData.events).forEach(function(eventName) {
					var eventCallback = watcherData.events[eventName];

					this.logger.info('Running watcher "%s"', this.getWatcherNameByPath(watcherPath));
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

	getWatcherNameByPath: function(watcherPath) {
		var fileDirPath     = path.dirname(watcherPath);
		var fileSubDirPath  = path.dirname(fileDirPath);
		var fileDirName     = path.basename(fileDirPath);
		var fileSubDirName  = path.basename(fileSubDirPath);

		return sprintf('%s/%s', fileSubDirName, fileDirName);
	},

	watchRequested: function() {
		return !!argv.watch;
	}
};

var LOG_LEVEL = {
	TRACE:  Logger.TRACE,
	DEBUG:  Logger.DEBUG,
	INFO:   Logger.INFO,
	WARN:   Logger.WARN,
	ERROR:  Logger.ERROR,
	FATAL:  Logger.FATAL
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

		setUserInputValue:  shark.setUserInputValue.bind(shark),
		getUserInputValue:  shark.getUserInputValue.bind(shark),

		runTask:            promisify(function *(taskName) {
			return yield shark.runTask(taskName, shark.logger.fields.deepLevel);
		}.bind(this)),
		runRequestedTask:   promisify(shark.runRequestedTask, shark),
		runWatcher:         promisify(shark.runWatcher, shark),
		getTaskList:        promisify(shark.getTaskList, shark),
		isWatcherRunning:   function() {
			return shark.isWatcherRunning;
		},

		LOG_LEVEL: LOG_LEVEL
	};
};

module.exports.LOG_LEVEL = LOG_LEVEL;