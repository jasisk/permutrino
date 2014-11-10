var spawn = require('child_process').spawn;
var exec = require('child_process').exec;
var minimist = require('minimist');
var assert = require('assert');
var rimraf = require('rimraf');
var diff = require('diff');
var path = require('path');
var fs = require('fs');

var checkGraph;
var registry;
var counter;
var modules;
var tmpDir;
var tmpPkg;
var srcPkg;
var cmd;

cmd = 'npm';
counter = 0;
registry = 'http://npm.paypal.com';
checkGraph = checkGraphGenerator();
tmpDir = path.resolve(__dirname, 'tmp');
tmpPkg = path.resolve(tmpDir, 'package.json');
srcPkg = path.resolve(__dirname, 'templates', 'package.json.template');

var argv = minimist(process.argv.slice(2));
if (process.env.PERMUTRON_MODULES) {
  modules = process.env.PERMUTRON_MODULES.split(',');
} else {
  modules = argv._;
}

if (!modules || !modules.length) {
  console.error('Permutron expects modules to check.');
  process.exit(1);
}

cleanUp();

series(permute(modules), function (modules, cb) {
  var opts;
  console.log('Permutation %d ...', ++counter);
  opts = {dedupe: argv.dedupe}
  testInstall(modules, opts, cb);
}, function (err) {
  cleanUp();
  if (err) {
    console.error(err.message);
    process.exit(1);
  } else {
    console.log('Success.');
  }
});

process.on('SIGINT', cleanUp);

function permute(items) {
  return items.reduce(function (prev, item, idx) {
    var clone = items.slice();
    var head = clone.splice(idx, 1);
    var permutations = ~-clone.length ? permute(clone) : clone;
    return prev.concat(permutations.reduce(function (prev, item) {
      prev.push(head.concat(item));
      return prev;
    }, []));
  }, []);
}

function testInstall(modules, _opts, cb) {
  var args = ['--registry=' + registry, 'install', '--save'];
  var opts = { cwd: tmpDir };

  fs.mkdirSync(tmpDir);
  cpSync(srcPkg, tmpPkg);

  series(modules, function (module, cb) {
    console.log('installing %s ...', module);
    spawn(cmd, args.concat(module), opts).on('close', function (code) {
      var err;
      if (code) {
        console.error('Failed to install.');
        err = new Error('exited with error code ' + code);
      }
      cb(err);
    });
  }, function (err) {
    if (err) {
      return done(err);
    }
    if (_opts.dedupe) {
      dedupe(done);
    } else {
      done();
    }
  });

  function dedupe(done) {
    spawn(cmd, ['dedupe', 'servicecore'], opts).on('close', function (code) {
      var err;
      if (code) {
        err = new Error('Failed to dedupe.');
      }
      done(err);
    });
  }

  function done(err) {
    args[1] = 'ls';
    exec(cmd + ' ' + args.join(' '), opts, function (err, stdout, stderr) {
      if (err) {
        return cb(err);
      }

      if (checkGraph(stdout)) {
        cleanUp();
        console.log('Dependency graph checks out.');
      } else {
        err = new Error('Bad dependency graph.');
      }
      cb(err);
    });
  }
}

function cleanUp() {
  rimraf.sync(tmpDir);
}

function series(arr, iterator, done) {
  var idx = 0;
  done || (done = function () {});
  if (!arr.length) {
    done();
  }

  iterate();

  function iterate() {
    iterator(arr[idx], cb);
  }

  function cb(err) {
    if (err) {
      done(err);
    } else {
      if (++idx === arr.length) {
        done();
      } else {
        iterate();
      }
    }
  }
}

function checkGraphGenerator() {
  var lastResponse = '';
  return function checkGraph(output) {
    var _lastResponse = lastResponse;
    lastResponse = output;
    if (_lastResponse === '') {
      return true;
    }
    if (_lastResponse !== output) {
      var _diff = diff.diffLines(_lastResponse, output);
      _diff.forEach(function (part) {
        var indicator = ' ';
        part.added && (indicator = '+');
        part.removed && (indicator = '-');
        process.stderr.write(part.value.replace(/^(.+)$/gm, indicator + ' $1'));
      });
      return false;
    }
    return true;
  }
}

function cpSync(src, dest) {
  var contents = fs.readFileSync(src);
  fs.writeFileSync(dest, contents);
}
