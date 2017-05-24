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

// By default, we won't start up the replayer server.
var server;

switch (process.env.VCR_MODE) {
case 'record':
  var cache = require('./src/cache');
  cache.configure('record');
  break;
case 'playback':
  var cache = require('./src/cache');
  cache.configure('playback');
  break;
case 'cache':
  var cache = require('./src/cache');
  cache.configure('cache');
  break;
// otherwise, leave http alone
}

function withreplayerServer() {
  switch (process.env.VCR_MODE) {
  case 'record':
  case 'playback':
  case 'cache':
    server = require('./src/server');
    break;
  }

  // Allows for:
  //   var replayer = require('replayer').withreplayerServer();
  return module.exports;
}

// It's safe to call this function whether or not replayer had any effect.
function shutdown(next) {
  if (server) {
    return server.shutdown(next);
  }

  if (next) {
    next();
  }
}

var replayerUtil = require('./src/util');
module.exports.enable = cache.enable;
module.exports.disable = cache.disable;
module.exports.isEnabled = cache.isEnabled;
module.exports.filter = replayerUtil.addFilter;
module.exports.substitute = replayerUtil.addSubstitution;
module.exports.fixtureDir = replayerUtil.setFixtureDir;
module.exports.configure = replayerUtil.configure;
module.exports.withreplayerServer = withreplayerServer;
module.exports.shutdown = shutdown;
