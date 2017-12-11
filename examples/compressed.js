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
    
    var body = zlib[encoding + 'Sync'](new Buffer('hello, ' + encoding));

    res.writeHead(200, headers);
    res.end(body);
  })
  .listen(1337, '0.0.0.0');

// -- HTTP REQUEST -------------------------------------------------------------

function makeHttpRequest(encoding, next) {
  var start = Date.now();

  request(
    {
      url: 'http://localhost:1337/' + encoding,
      method: 'GET',
      headers: {
        'accept-encoding': encoding,
      },
    },
    function(err, data, body) {
      var time = Date.now() - start;

      console.log(encoding.toUpperCase() + ' COMPRESSION:');
      console.log('  status:', data.statusCode);
      console.log('  body  :', body);
      console.log('  time  :', time);

      common.verify(function() {
        data.headers.should.not.have.property('content-encoding');
        body.should.equal('hello, ' + encoding);
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
  function() { makeHttpRequest('gzip', this); },
  function() { makeHttpRequest('deflate', this); },
  _.bind(httpServer.close, httpServer)
);
