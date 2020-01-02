// Copyright 2013 LinkedIn Corp.
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

var fs = require('fs');
var zlib = require('zlib');
var replayerUtil = require('./util');
var EventEmitter = require('events').EventEmitter;
var http = require('http');
var url = require('url');
var mimeTypes = require('mime-types');

var playbackHits = true;
var recordMisses = true;
var requestMethodsToStub = [
  'abort',
  'addTrailers',
  'destroy',
  'flush',
  'flushHeaders',
  'hasHeader',
  'onSocket',
  'removeHeader',
  'setNoDelay',
  'setSocketKeepAlive',
  'setTimeout'
];

module.exports.configure = function (mode) {
  switch (mode) {
    case 'record':
      playbackHits = false;
      recordMisses = true;
      break;

    case 'playback':
      playbackHits = true;
      recordMisses = false;
      break;

    case 'cache':
      playbackHits = true;
      recordMisses = true;
      break;

    default:
      throw new Error('Unrecognized mode: ' + mode);
  }
};

/**
* Turns replayer on.
*/
module.exports.enable = function enable() {
  ['http', 'https'].forEach(function (protocol) {
    var protocolModule = require(protocol);
    if (protocolModule.__replayerRequest) {
      protocolModule.request = protocolModule.__replayerRequest;
    } else {
      throw new Error('Unexpectedly, %s.__replayerRequest is missing.  Cannot enable replayer.', protocol);
    }
  });
};

/**
* Turns replayer off.
*/
module.exports.disable = function disable() {
  ['http', 'https'].forEach(function (protocol) {
    var protocolModule = require(protocol);
    if (protocolModule.__originalRequest) {
      protocolModule.request = protocolModule.__originalRequest;
    } else {
      throw new Error('Unexpectedly, %s.__replayerRequest is missing.  Cannot enable replayer.', protocol);
    }
  });
};

module.exports.isEnabled = function isEnabled() {
  var http = require('http');
  var https = require('https');
  if (http.request === http.__replayerRequest) {
    if (https.request === https.__replayerRequest) {
      return true;
    } else {
      throw new Error('Http and https request methods are in a conflicted state.');
    }
  } else {
    if (https.request === https.__replayerRequest) {
      throw new Error('Http and https request methods are in a conflicted state.');
    } else {
      return false;
    }
  }
};

//
['http', 'https'].forEach(function (protocol) {
  var protocolModule = require(protocol);
	var oldRequest = protocolModule.request;
  protocolModule.__originalRequest = oldRequest;

  // Ensure there are enough sockets to handle timeout issues that arise due to
  // slow servers or unaccessible servers when recording.
  protocolModule.globalAgent.maxSockets = 1000;

  protocolModule.__replayerRequest = protocolModule.request = function replayerRequest(options, callback) {
    var reqUrl;
    if (typeof options === 'string') {
      reqUrl = options;
      options = url.parse(options);
    } else {
      reqUrl = replayerUtil.urlFromHttpRequestOptions(options, protocol);
    }
    var reqBody = [];
    var debug = replayerUtil.shouldFindMatchingFixtures();

		var req = stubMethods(new EventEmitter());

		req.getHeaders = function getHeaders() {
			return this.header;
		};

		req.setHeader = function setHeader(key, val) {
			if(!this.header) {
        this.header = {};
      }
      this.header[key] = val;
		};

		req.getHeader = function getHeader(key) {
			return this.header[key];
		};

		req.getHeaderName = function getHeaderName() {
			return Object.keys(this.header);
		};

    req.write = function (chunk) {
      reqBody.push(chunk);
    };

    req.end = function (lastChunk) {
      if (lastChunk) {
        reqBody.push(lastChunk);
      }

      reqBody = reqBody.map(function (chunk) {
        if (!Buffer.isBuffer(chunk)) {
          return new Buffer(chunk);
        } else {
          return chunk;
        }
      });

      reqBody = Buffer.concat(reqBody);
      var filename = replayerUtil.constructFilename(options.method, reqUrl,
        reqBody.toString(), options.headers);

      options.headers = replayerUtil.removeInternalHeaders(options.headers);

      var forceLive = replayerUtil.shouldForceLive(reqUrl);

      // Only called if either the fixture with the constructed filename
      // exists, or we're playing back passed in data.
      function playback(resHeaders, resBody) {
        if (!forceLive) {
          var headerContent = replayerUtil.substituteWithRealValues(
            fs.readFileSync(filename + '.headers').toString());
          resHeaders = JSON.parse(headerContent);
        }

        var socket = new EventEmitter();
        socket.setTimeout = socket.setEncoding = function () { };
        // Needed for node 0.8.x
        socket.destroy = socket.pause = socket.resume = function () { };

        req.socket = socket;
        req.emit('socket', socket);

        if (!resHeaders) {
          if (resBody.error) {
            req.emit('error', resBody.error);
          } else {
            req.emit('error',
              new Error(`No response headers. Response body: ${JSON.stringify(resBody)}`));
          }
          return;
        }

        if (resHeaders.timeout) {
          socket.emit('timeout');
          req.emit('error', new Error('Timeout'));
          return;
        }

        if (resHeaders.error) {
          req.emit('error', resHeaders.error);
          return;
        }

        var res = new http.IncomingMessage(socket);
        res.headers = resHeaders.headers || {};
        res.statusCode = resHeaders.statusCode;

        if (callback) {
          callback(res);
        }

        if (!forceLive) {
          var isBinary = !mimeTypes.charset(resHeaders['content-encoding']);
          resBody = isBinary ?
            fs.readFileSync(filename) :
            replayerUtil.substituteWithRealValues(fs.readFileSync(filename).toString());
        }

        req.emit('response', res);

        if (res.push) {
          // node 0.10.x
          res.push(resBody);
          res.push(null);
        } else {
          // node 0.8.x
          res.emit('data', resBody);
          res.emit('end');
        }
      }

      // If the file exists and we allow playback (e.g. we are not in
      // record-only mode), then simply play back the call.
      if (playbackHits && !forceLive && fs.existsSync(filename + '.headers')) {
        playback();
        return;
      }

      // If we are not recording, and the fixtures file does not exist, then
      // throw an exception.
      if (!recordMisses && !forceLive) {
        // But, create a .missing file before throwing the exception.
        var requestData = {
          url: reqUrl,
          method: options.method,
          headers: options.headers,
          body: reqBody.toString()
        };

        var missingFileName = filename + '.missing';
        fs.writeFileSync(missingFileName,
          JSON.stringify(requestData, null, 2));

        if (debug) {
          var bestMatchFileName =
            replayerUtil.findTheBestMatchingFixture(missingFileName);
          if (bestMatchFileName) {
            throw new Error('Fixture ' + filename + ' not found,  Expected ' +
              missingFileName +
              ' , but the best match is ' + bestMatchFileName);
          } else {
            throw new Error('Fixture ' + filename +
              ' not found and could not compute the best matching fixture');
          }
        }

        throw new Error('Fixture ' + filename + ' not found.');
      }

      // Remember how long it took to perform this action.
      var startTime = Date.now();
      var timedOut = false;

      function writeHeaderFile(headers) {
        var timeLength = Date.now() - startTime;
        headers.url = reqUrl;
        headers.time = timeLength;
        headers.request = {
          method: options.method,
          headers: options.headers
        };

        fs.writeFileSync(filename + '.headers',
          replayerUtil.substituteWithOpaqueKeys(JSON.stringify(headers, null, 2)));
      }

      // Suppose the request times out while recording. We don't want the
      // fixtures file to be missing; we want to send back a timeout on
      // playback. To accomplish this, we write a timeout to the .header file
      // pre-emptively, then overwrite it with the server response if the
      // request doesn't time out.
      if (!forceLive) {
        writeHeaderFile({
          timeout: true,
          time: 30000
        });
      }

      var realReq = oldRequest(options, function (res) {
        // It's important that we don't respect the encoding set by
        // application because we want to treat the incoming data as a
        // buffer. When body data is treated as a string, there are issues
        // writing it to a file. With non-ASCII messages, the string's length
        // (in characters) is not necessarily the same as the buffer's length
        // (in bytes). Thus, the solution is to treat the data as a buffer
        // without allowing conversion into a string.
        res.setEncoding = function () { };

        var resBodyChunks = [];
        res.on('data', function (chunk) {
          resBodyChunks.push(chunk);
        });
        res.on('end', function () {
          var resBody = Buffer.concat(resBodyChunks);
          // uncompress the response body if required
          switch (res.headers['content-encoding']) {
            case 'gzip':
            case 'deflate':
              resBody = zlib.unzipSync(resBody);
              delete res.headers['content-encoding'];
              break;
          }

          if (forceLive) {
            // Don't write the response to any files, and just send it back to
            // whoever issued the request.
            playback({
              statusCode: res.statusCode,
              headers: res.headers
            }, resBody);
          } else {
            var isBinary = !mimeTypes.charset(res.headers['content-encoding']);

            if (isBinary) {
              fs.writeFileSync(filename, resBody);
            } else {
              fs.writeFileSync(filename,
                replayerUtil.substituteWithOpaqueKeys(resBody.toString())
              );
            }

            // Store the request, if debug is true
            if (debug) {
              var requestData = {
                url: reqUrl,
                method: options.method,
                headers: options.headers,
                body: reqBody.toString()
              };
              writeRequestFile(requestData, filename);
            }

            writeHeaderFile({
              statusCode: res.statusCode,
              headers: res.headers
            });

            playback();
          }
        });
      });

      realReq.on('error', function (error) {
        var header = {
          error: error
        };

        if (timedOut) {
          header.timeout = true;
        }

        if (forceLive) {
          // Don't write the error to a file, and just send it back to whoever
          // issued the request.
          playback(undefined, header);
        } else {
          writeHeaderFile(header);
          playback();
        }
      });

      realReq.on('socket', function (socket) {
        var timeoutListener = function () { timedOut = true; };
        var cleanupSocket = function () {
          socket.removeListener('timeout', timeoutListener);
        };

        socket.on('timeout', timeoutListener);
        realReq.on('response', cleanupSocket);
        realReq.on('error', cleanupSocket);
        realReq.on('abort', cleanupSocket);
        realReq.on('end', cleanupSocket);
      });

      var that = this;
      //Add headers to the original request if exist, specifically content-length and content-type for JSON
			Object.keys(that.header || []).forEach(function(headerKey) {
				realReq.setHeader(headerKey, that.header[headerKey]);
				return;
      });
      
      realReq.end(reqBody);
    };
    return req;
  };
});

function stubMethods(req) {
  requestMethodsToStub.forEach(function (method) {
    req[method] = function () { };
  });

  return req;
}

function writeRequestFile(requestData, filename) {
  fs.writeFileSync(filename + '.request',
    JSON.stringify(requestData, null, 2));
}

module.exports.internal = {};
module.exports.internal.writeRequestFile = writeRequestFile;
