var gulp = require('gulp');
var gutil = require('gulp-util');
var clean = require('gulp-clean');
var spawn = require('child_process').spawn;
var fs = require('fs');
var Sequelize = require('sequelize');
var replace = require('gulp-replace');
var _ = require('lodash');

// Clean build folder
gulp.task('clean-build', function() {
  return gulp.src('build/**/*', {read: false})
    .pipe(clean());
});

// Copy template
gulp.task('copy-template', ['clean-build'], function() {
  return gulp.src('template/**/*')
    .pipe(gulp.dest('build/'));
});

// Download sinonjs.org docs
gulp.task('wget-download', ['copy-template'], function(cb) {
  var args = [
    '-nH', // No domain in folder names
    '--cut-dirs=1', // Remove /docs/ from folder names
    '-k', // Fix links (to make sure that they will work locally)
    '-p', // --page-requisites (all required files to show this page)
    '-E', // Force to add .css, .js extensions
    '-P', 'build/Sinon.JS.docset/Contents/Resources/Documents/', // Download to documents folder
    'http://sinonjs.org/docs/' // What to download
  ]
  spawn( 'wget', args, { stdio: 'inherit' })
    .on('error', cb)
    .on('exit', function(code) { cb(code === 0 ? null : code); });
});

// Add ids for all methods
gulp.task('fix-indexes', ['wget-download'], function() {
  return gulp.src(['./build/Sinon.JS.docset/Contents/Resources/Documents/index.html'])
    .pipe(replace(/<dt><code>((var \w+ = )?([a-z\.]+)(\([a-z\d, \."]*\))?;?)<\/code><\/dt>/ig, '<dt id="$3"><code>$1</code></dt>'))
    .pipe(gulp.dest('./build/Sinon.JS.docset/Contents/Resources/Documents/'));
});

gulp.task('build-index', ['fix-indexes'], function(cb) {
  var databaseFile = './build/Sinon.JS.docset/Contents/Resources/docSet.dsidx';
  var indexLogFile = './build/index.log';

  var data = fs.readFileSync('./build/Sinon.JS.docset/Contents/Resources/Documents/index.html');

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

      fs.appendFileSync(indexLogFile, JSON.stringify(index) + '\n');
    }
  }

  buildIndexes(
    /<dt\b[^>]*id="([\w\.\-]+)"[^>]*><code>((var \w+ = )?([\w\.]+)(\([\w, \."]*\))?;?)<\/code><\/dt>/ig,
    /* nameMatch: */ 4, /* pathMatch: */ 1, 'Function'
  );
  buildIndexes(
    /<div\b[^<>]*id="([\w\.\-]+)"[^>]*>\s*<h2\b[^>]*>(([^<>]|<code>|<\/code>)*)(<a\b[^>]*>(.*)<\/a>)?<\/h2>/ig,
    /* nameMatch: */ 2, /* pathMatch: */ 1, 'Section'
  );
  buildIndexes(
    /<h3\b[^<>]*id="([\w\.\-]+)"[^>]*>(.*)<\/h3>/ig,
    /* nameMatch: */ 2, /* pathMatch: */ 1, 'Guide'
  );

  var seq = new Sequelize('database', 'username', 'password', {
    dialect: 'sqlite',
    storage: databaseFile
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

gulp.task(
  'build', 
  [
    'clean-build', 
    'copy-template', 
    'wget-download', 
    'fix-indexes',
    'build-index'
  ]
);