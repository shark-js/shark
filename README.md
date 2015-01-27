Shark
===

# Getting Started

#### 1. Install shark-cli globally:

```sh
$ npm install shark-cli -g
```

#### 2. Install shark in your project devDependencies:

```sh
$ npm install shark-core --save-dev
```

#### 3. Create a `sharkfile.js` at the root of your project:

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
