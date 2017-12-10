var http = require('http');
var request = require('request');
var _ = require('lodash');
var step = require('step');
var zlib = require('zlib');
require('should');
var common = require('./common');

common.ensureNonCacheMode('compressed.js');

require('..');

// -- TEST SERVER --------------------------------------------------------------

// 1. Returns a gzip compressed string

var httpServer = http
  .createServer(function(req, res) {
    var encoding = req.headers['accept-encoding'] || 'gzip';
    var headers = {
      'content-type': 'text/plain',
      'content-encoding': req.headers['accept-encoding'],
    };
    
    var body = '';
    if (encoding === 'gzip') {
      body = zlib.gzipSync(new Buffer('hello, gzip'));
    } else {
      body = zlib.deflateSync(new Buffer('hello, deflate'));
    }

    // simulate server latency
    setTimeout(function() {
      res.writeHead(200, headers);
      res.end(body);
    }, 500);
  })
  .listen(1337, '0.0.0.0');

// -- HTTP REQUEST -------------------------------------------------------------

function makeGzipHttpRequest(next) {
  var start = Date.now();

  request(
    {
      url: 'http://localhost:1337/gzip',
      method: 'GET',
      headers: {
        'accept-encoding': 'gzip',
      },
    },
    function(err, data, body) {
      var time = Date.now() - start;

      console.log('GZIP COMPRESSION:');
      console.log('  status:', data.statusCode);
      console.log('  body  :', body);
      console.log('  time  :', time);

      common.verify(function() {
        data.headers.should.not.have.property('content-encoding');
        body.should.equal('hello, gzip');
      });

      console.log();

      next();
    }
  );
}

function makeDeflateHttpRequest(next) {
  var start = Date.now();

  request(
    {
      url: 'http://localhost:1337/deflate',
      method: 'GET',
      headers: {
        'accept-encoding': 'deflate',
      },
    },
    function(err, data, body) {
      var time = Date.now() - start;

      console.log('DEFLATE COMPRESSION:');
      console.log('  status:', data.statusCode);
      console.log('  body  :', body);
      console.log('  time  :', time);

      common.verify(function() {
        data.headers.should.not.have.property('content-encoding');
        body.should.equal('hello, deflate');
      });

      console.log();

      next();
    }
  );
}

// -- RUN EVERYTHING -----------------------------------------------------------

step(
  function() {
    setTimeout(this, 100);
  }, // let the server start up
  function() {
    makeGzipHttpRequest(this);
    makeDeflateHttpRequest(this);
  },
  _.bind(httpServer.close, httpServer)
);
