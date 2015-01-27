Shark
===

# Getting Started

#### 1. Install shark-cli globally:

```sh
$ npm install shark-cli -g
```


#### 2. Add next line to your ~/.bashrc or ~/.zshrc which enables shark tab-completion

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
