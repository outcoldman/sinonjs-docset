var gulp = require('gulp');
var gutil = require('gulp-util');
var clean = require('gulp-clean');
var spawn = require('child_process').spawn;
var fs = require('fs');
var Sequelize = require('sequelize');
var replace = require('gulp-replace');
var _ = require('lodash');
var path = require('path');

var BUILD_PATH = 'build';
var RESOURCES_PATH = path.join(BUILD_PATH, 'Sinon.JS.docset/Contents/Resources');
var DOCUMENTS_PATH = path.join(RESOURCES_PATH, 'Documents');

var FEEDS_PATH = 'feeds';

// Clean build folder
gulp.task('clean-build', function() {
  return gulp.src(BUILD_PATH + '/**/*', {read: false})
    .pipe(clean());
});

// Copy template
gulp.task('copy-template', ['clean-build'], function() {
  return gulp.src('template/**/*')
    .pipe(gulp.dest(BUILD_PATH));
});

// Download sinonjs.org docs
gulp.task('wget-download', ['copy-template'], function(cb) {
  var args = [
    '-nH', // No domain in folder names
    '--cut-dirs=1', // Remove /docs/ from folder names
    '-k', // Fix links (to make sure that they will work locally)
    '-p', // --page-requisites (all required files to show this page)
    '-E', // Force to add .css, .js extensions
    '-P', DOCUMENTS_PATH, // Download to documents folder
    'http://sinonjs.org/docs/' // What to download
  ]
  spawn( 'wget', args, { stdio: 'inherit' })
    .on('error', cb)
    .on('exit', function(code) { cb(code === 0 ? null : code); });
});

// Add ids for all methods
gulp.task('fix-indexes', ['wget-download'], function() {
  return gulp.src([path.join(DOCUMENTS_PATH, 'index.html')])
    .pipe(
      replace(
        /<dt><code>((var \w+ = )?([a-z\.]+)(\([a-z\d, \."]*\))?;?)<\/code><\/dt>/ig, 
        '<dt id="$3"><a name="//apple_ref/cpp/Function/$3" class="dashAnchor"><code>$1</code></a></dt>'
      )
    )
    .pipe(gulp.dest(DOCUMENTS_PATH));
});

gulp.task('build-index', ['fix-indexes'], function(cb) {
  var data = fs.readFileSync(path.join(DOCUMENTS_PATH, 'index.html'));

  var indexes = {};

  function buildIndexes(regex, nameMatch, pathMatch, type) {
    var match;
    while ((match = regex.exec(data)) !== null)
    {
      var index = {
        name: match[nameMatch].replace(/<[^<>]+>/g, ''),
        type: type,
        path: 'index.html#' + match[pathMatch]
      }

      if (indexes[index.name] && indexes[index.name].path !== index.path) {
        var nameIndex = 0;
        var originalName = index.name;
        do {
          index.name = originalName + ' (' + (++nameIndex) + ')';
        } while(indexes[index.name] && indexes[index.name].path !== index.path);
      }

      if (!indexes[index.name]) {
        indexes[index.name] = index;
      }

      fs.appendFileSync(path.join(BUILD_PATH, 'index.log'), JSON.stringify(index) + '\n');
    }
  }

  buildIndexes(
    /<dt\b[^>]*id="([\w\.\-]+)"[^>]*><a\b[^>]*><code>((var \w+ = )?([\w\.]+)(\([\w, \."]*\))?;?)<\/code><\/a><\/dt>/ig,
    /* nameMatch: */ 4, /* pathMatch: */ 1, 'Function'
  );
  buildIndexes(
    /<div\b[^<>]*id="([\w\.\-]+)"[^>]*>\s*<h2\b[^>]*>(([^<>]|<code>|<\/code>)*)(<a\b[^>]*>(.*)<\/a>)?<\/h2>/ig,
    /* nameMatch: */ 2, /* pathMatch: */ 1, 'Guide'
  );

  var seq = new Sequelize('database', 'username', 'password', {
    dialect: 'sqlite',
    storage: path.join(RESOURCES_PATH, 'docSet.dsidx')
  });

  // Copy to DB
  var SearchIndex = seq.define('searchIndex', {
    id: { type: Sequelize.INTEGER, autoIncrement: true },
    name: { type: Sequelize.STRING, unique: true },
    type: { type: Sequelize.STRING },
    path: { type: Sequelize.STRING }
  }, {
    freezeTableName: true,
    timestamps: false
  });

  SearchIndex.sync().success(function() {
    SearchIndex.bulkCreate(_.values(indexes))
      .success(function() {
        cb();
      })
      .error(cb);
  });
});

gulp.task('create-feed', ['build-index'], function(cb) {
  if (fs.existsSync(path.join(FEEDS_PATH, 'sinon.js.tgz'))) {
    fs.unlinkSync(path.join(FEEDS_PATH, 'sinon.js.tgz'));
  }

  var args = [
    '--exclude=".DS_Store"', 
    '-cvzf', path.join(FEEDS_PATH, 'sinon.js.tgz'),
    path.join(BUILD_PATH, 'Sinon.JS.docset')
  ]
  spawn( 'tar', args, { stdio: 'inherit' })
    .on('error', cb)
    .on('exit', function(code) { cb(code === 0 ? null : code); });
});

gulp.task('update-feed-version', ['wget-download'], function() {
  var data = fs.readFileSync(path.join(DOCUMENTS_PATH, 'sinon.js'));
  var versionMatch = /^ \* Sinon.JS ([\d\.]+),/m.exec(data);
console.log(JSON.stringify(versionMatch));
  return gulp.src([path.join(FEEDS_PATH, 'sinon.js.xml')])
    .pipe(
      replace(
        /<version>([\d\.]+)<\/version>/ig, 
        '<version>' + versionMatch[1] + '</version>'
      )
    )
    .pipe(gulp.dest(FEEDS_PATH));
});

gulp.task(
  'build', 
  [
    'clean-build', 
    'copy-template', 
    'wget-download', 
    'fix-indexes',
    'build-index',
    'create-feed',
    'update-feed-version'
  ]
);