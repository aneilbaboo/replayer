// Copyright 2013 Aneil Mallavarapu
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * -- CACHE --------------------------------------------------------------------
 *
 * rm -r fixtures
 * VCR_MODE=cache node examples/cache
 *
 * Exercise the cache mode by making an HTTP request without any fixtures, then
 * re-making that request. The request should take substantially less time the
 * second time, since the fixture will be created by the first call.
 */

var http = require('http');
var request = require('request');
var step = require('step');
var common = require('./common');
var fs = require('fs');
var path = require('path');

const IMAGE = fs.readFileSync(path.join(__dirname, 'nodejslogo.png'));

require('..');

// -- ECHO SERVER --------------------------------------------------------------

var httpServer = http.createServer(function(req, res) {
  // simulate server latency
  setTimeout(function() {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(IMAGE, 'binary');
  }, 1000);
}).listen(1337, '0.0.0.0');

// -- HTTP REQUESTS ------------------------------------------------------------

function makeRequest(title, cacheHitExpected, next) {
  var start = Date.now();

  request({
    url: 'http://localhost:1337/',
    encoding: null
  }, function(err, data, body) {
    var time = Date.now() - start;

    var receivedImage = new Buffer(body, 'binary');

    console.log(title);
    console.log('  status:', data.statusCode);
    console.log('  receivedImage.length  :', receivedImage.length);
    console.log('  time  :', time);
    
    common.verify(function() {
      
      if (!IMAGE.equals(receivedImage)) {
         throw new Error('Expected to receive image ('+IMAGE.length+' bytes), but received ('+receivedImage.length+' bytes)');
      }

      common.shouldUseCache(cacheHitExpected, time);
    });

    console.log();

    next();
  });
}

// -- RUN EVERYTHING -----------------------------------------------------------

step(
  function() { setTimeout(this, 100); }, // let the server start up
  function() { makeRequest('NO FIXTURES' , false, this); },
  function() { makeRequest('YES FIXTURES', true , this); },
  httpServer.close.bind(httpServer)
);
