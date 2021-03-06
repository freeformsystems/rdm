var async = require('async')
  , EOL = require('os').EOL
  , DNL = EOL
  , fs = require('fs')
  , exec = require('child_process').exec
  , path = require('path')
  , dirname = path.dirname
  , util = require('util')
  , circular = require('circular')
  , utils = require('cli-util')
  , repeat = utils.repeat, rtrim = utils.rtrim
  , environ = require('cli-env')
  , block = '```'
  , formats = {
    code: block + EOL + '%s' + EOL + block,
    language: block + '%s' + EOL + '%s' + EOL + block
  }
  , LITERAL = 'literal'
  , INCLUDE = 'include'
  , REQUIRE = 'require'
  , REFERENCE = 'reference'
  , OBJECT = 'object'
  , BINARY = 'binary'
  , keys = [
    LITERAL,
    INCLUDE,
    REQUIRE,
    REFERENCE,
    OBJECT,
    BINARY
  ];

var aliases = {};
keys.forEach(function(key) {
  aliases[key] = [key];
  aliases[key].push(key.substr(0,3));
});

/* HANDLERS */

var handlers = {
  literal: literal,
  reference: reference,
  object: object,
  include: include,
  require: load,
  binary: binary
}

function literal(meta, value, section, callback) {
  return callback(null, value);
}

function reference(meta, value, section, callback) {
  // non-string properties are not references
  // defer to object type
  if(typeof value !== 'string') {
    return object(meta, value, section, callback);
  }
  // TODO: deep property lookup
  return callback(null, meta.root[value]);
}

function object(meta, value, section, callback) {
  return callback(null, value);
}

function include(meta, value, section, callback) {
  var base = meta.include ? meta.include : process.cwd();
  var file = path.normalize(path.join(base, value));
  // TODO: custom error handling
  fs.readFile(file, function(err, result) {
    if(err) {
      return callback(err);
    }
    result = '' + result;
    if(section.trim !== false) {
      result = rtrim(result);
    }
    callback(null, result);
  })
}

function binary(meta, value, section, callback) {
  var cmd = value;
  var opts = {
      env: {}, cwd: section.cwd || process.cwd(), shell: process.env.SHELL}
    , z;
  for(z in process.env) {
    opts.env[z] = process.env[z];

  }
  if(section.env) {
    for(z in section.env) {
      opts.env[z] = section.env[z];
    }
  }
  var paths = ['./node_modules/.bin', './bin', './sbin'];
  if(meta.directories && meta.directories.bin) {
    paths.push(meta.directories.bin);
  }
  // TODO: handle windows style path delimiters
  opts.env.PATH = opts.env.PATH + ':' + './node_modules/.bin';
  var bin = meta.bin || meta.files && meta.files.bin ? meta.files.bin : null;
  if(bin) {
    if(typeof bin === 'string') {
      paths.push(dirname(bin));
    }else{
      for(z in bin) {
        if(bin[z]) {
          paths.push(dirname(bin[z]));
        }
      }
    }
  }
  opts.env.PATH = opts.env.PATH + ':' + paths.join(':');
  exec(cmd, opts,
    function (err, stdout, stderr) {
      if(err !== null && !section.fails) {
        return callback(err);
      }
      return callback(null, section.stderr ? stderr : stdout);
    });
}

function load(meta, value, section, callback) {
  var pth
    , result;
  try {
    pth = value;
    if(meta.require) {
      pth = path.join(meta.require, pth);
    }
    if(!/^\//.test(value)) {
      pth = path.join(process.cwd(), pth);
    }
    result = require(pth);
  }catch(e) {
    return callback(e);
  }
  //util.inspect(result);
  return callback(null, result);
}

/* UTILS */

function get(key, section) {
  if(typeof section === 'string') {
    return {key: LITERAL, value: section, section: section};
  }
  var names = aliases[key];
  if(!names) {
    return false;
  }
  var i, value;
  for(i = 0;i < names.length;i++) {
    value = section[names[i]];
    if(value) {
      return {key: names[0], value: value, section: section};
    }
  }
  return false;
}

function nl(section) {
  if(!section) {
    return section;
  }
  var re = new RegExp(EOL + '$');
  if(!re.test(section)) {
    section += repeat(2, EOL);
  }
  return section;
}

function stringify(meta, section, value) {
  if(!section.stringify) {
    return value;
  }
  return JSON.stringify(value, circular(), section.indent || 2);
}

function format(meta, section, value) {
  var fmt = type(meta, section, value);
  if(typeof value === 'string' && section.trim) {
    value = value.trim();
  }
  //console.log('fmt %s', value);
  //console.log('fmt %s', fmt);
  if(!fmt && typeof value === 'string') {
    return value;
  }
  if(typeof value === 'string') {
    if(section.language) {
      return util.format(fmt, section.language, value);
    }
    return util.format(fmt, value);
  }else{
    if(typeof value === 'function') {
      value = '' + value;
    }else{
      value = JSON.stringify(value, circular(), section.indent || 2);
    }
    var str = section.language
      ? '```' + section.language + EOL
      : '```' + EOL;
    str += value + EOL + '```';
    return str;
  }
}

function env(meta, section, value) {
  return environ.replace(value);
}

function type(meta, section/*, value*/) {
  var fmt = section.format;
  if(section.type && formats[section.type]) {
    fmt = section.language ? formats.language : formats[section.type];
  }
  return fmt;
}

function partial(meta, info, callback) {
  if(!info.section) {
    return callback(null, false);
  }
  var func = handlers[info.key];
  if(typeof func === 'function') {
    return func.call(this, meta, info.value, info.section, callback);
  }
  return callback(new Error('Invalid partial information: ' + info.key));
}

function getPartialList(meta, target) {
  var partial = target || meta.partial, result = [];
  var list = [];
  // handle arrays as a collection of objects
  partial.forEach(function(item) {
    if(!Array.isArray(item)) {
      return list.push(item);
    }
    list = list.concat(item);
  })

  function collate(item) {
    if(typeof item === 'string') {
      item = {key: res.key, value: item, section: {}};
      item.section[res.key] = item.value;
      result.push(item);
    // assume nested array of definitions
    }else if(item && typeof item === 'object' && !Array.isArray(item)) {
      res = get(keys[j], item);
      result.push(res);
    }
  }

  var i, j, section, res;
  for(i = 0;i < list.length;i++) {
    section = list[i];
    for(j = 0;j < keys.length;j++) {
      res = get(keys[j], section);
      if(res) {
        if(Array.isArray(res.value)) {
          // collate keys as arrays
          res.value.forEach(collate);
        }else{
          result.push(res);
        }
        break;
      }
    }
  }
  return result;
}

function transform(meta, section, result) {
  if(result === '' && !section.title && !section.text) {
    return result;
  }
  result = stringify(meta, section, result);
  result = format(meta, section, result);
  //console.dir(result);
  var replace = meta.env === true && section.env !== false;
  if(replace) {
    result = env(meta, section, result);
  }
  var preamble = '';
  if(section.title) {
    preamble += repeat(
      section.level || meta.level, '#') + ' ' + section.title + DNL;
  }
  if(section.text) {
    preamble += section.text + DNL;
  }

  if(section.footer) {
    result = result + DNL + section.footer;
  }

  result = preamble + result;

  // add newlines between results
  return nl(result);
}

function partials(meta, callback) {
  var result = getPartialList(meta);
  if(meta.links) {
    result.push(
      {key: INCLUDE, value: meta.links, section: {include: meta.links}});
  }
  //console.dir(result);
  async.mapSeries(result, function(item, callback) {
    partial(meta, item, function(err, result) {
      if(err) {
        return callback(err);
      }
      callback(null, {result: result, info: item});
    });
  }, function(err, results) {
    if(err) {
      return callback(err);
    }
    results = results.filter(function(def) {
      if(!def || !def.result || !def.info) {
        return false;
      }
      return def;
    }).map(function(def) {
      var section = def.info.section;
      var result = def.result;
      if(result) {
        return transform(meta, section, result);
      }
    })
    callback(null, results);
  })
}

function title(meta, callback) {
  var heading = this.title || meta.title || meta.root.name;
  if(typeof heading === 'string') {
    return callback(null, heading);
  // treat title as a partial
  }else if(heading && typeof heading === 'object'){
    var list = getPartialList(meta, [heading]);
    partial(meta, list[0], function(err, result) {
      return callback(err, {result: result, info: list[0]});
    });
  }else{
    return callback(null, '');
  }
}

function parse(meta, callback) {
  var cli = this;
  title.call(this, meta, function(err, def) {
    if(err) {
      return callback(err);
    }
    var title = def;
    if(typeof def !== 'string') {
      title = rtrim(transform(meta, def.info.section, def.result));
    }
    meta.root.title = title;
    var markdown = (cli.man || !title) ? '' : nl('# ' + title);
    partials.call(this, meta, function(err, result) {
      if(err) {
        return callback(err);
      }
      //console.dir(result);
      markdown += result.join('');
      return callback(null, markdown);
    });
  });
}

module.exports = parse;
