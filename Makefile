REPORTER = spec

test:
	@NODE_ENV=test node --harmony ./node_modules/mocha/bin/_mocha -b --reporter $(REPORTER)

test-cov:
	@NODE_ENV=test node --harmony ./node_modules/istanbul-harmony/lib/cli.js cover \
	./node_modules/mocha/bin/_mocha -- -R spec

test-coveralls:
	echo TRAVIS_JOB_ID $(TRAVIS_JOB_ID)
	$(MAKE) test
	@NODE_ENV=test node --harmony ./node_modules/istanbul-harmony/lib/cli.js cover \
	./node_modules/mocha/bin/_mocha --report lcovonly -- -R spec && \
		cat ./coverage/lcov.info | ./node_modules/coveralls/bin/coveralls.js || true

.PHONY: test