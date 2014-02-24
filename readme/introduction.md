Designed to generate markdown documents from a series of partials. Partials are defined within a `readme` section of `package.json`.

A partial may be one of:

* `string`: A string literal.
* `property`: A property reference.
* `include`: Include a file, normally a markdown document but not necessarily.
* `script`: Execute a command and use `stdout` as the content.
* `require`: Require a `.js` module or a `.json` file.