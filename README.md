Shark
===

[![Build Status](https://img.shields.io/travis/shark-js/shark/master.svg)](https://travis-ci.org/shark-js/shark)
[![Build status](https://ci.appveyor.com/api/projects/status/umxg297hoyjd4iq2?svg=true)](https://ci.appveyor.com/project/vadimgoncharov/shark)
[![Coverage Status](https://img.shields.io/coveralls/shark-js/shark/master.svg)](https://coveralls.io/r/shark-js/shark)
# Getting Started

#### 1. Install shark-cli globally:

```sh
$ npm install shark-cli -g
```


#### 2. Add next line to your ~/.bashrc or ~/.zshrc to enable shark tab-completion

```sh
. <(shark completion)
```

#### 3. Install shark in your project devDependencies:

```sh
$ npm install shark-core --save-dev
```

#### 4. Create a `sharkfile.js` at the root of your project:

```js
'use strict';

const path  = require('path');
const Shark = require('shark-core');

const shark = Shark({
  tasksPath: path.join(__dirname, './shark/tasks')
});

module.exports = shark;
```

#### 4. Run shark:
```sh
$ shark
```
