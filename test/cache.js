require('should');
var cache = require('../src/cache');
var sinon = require('sinon');
var fs = require('fs');

describe('cache.js', function() {

  describe('#writeRequestFile', function() {

    before(function() {
      sinon.stub(fs, 'writeFileSync');
    });

    var requestData = {
      data: 'data'
    };

    it('should write the request to the file', function() {
      cache.internal.writeRequestFile(requestData, 'myrequest');
      fs.writeFileSync.called.should.equal(true);
      fs.writeFileSync.calledWith('myrequest.request',
        JSON.stringify(requestData, null, 2)).should.equal(true);
    });

    after(function() {
      fs.writeFileSync.restore();
    });

  });

  describe('enablement and disablement', function () {
    after(function () {
      cache.enable();
    });

    it('should be enabled by default', function () {
      require('http').request.name.should.equal('replayerRequest');
      require('https').request.name.should.equal('replayerRequest');
    });

    it('should have assigned __originalRequest and __replayerRequest functions', function () {
      var http = require('http');
      var https = require('https');
      http.__originalRequest.name.should.equal('request');
      https.__originalRequest.name.should.equal('request');
      http.__replayerRequest.name.should.equal('replayerRequest');
      https.__replayerRequest.name.should.equal('replayerRequest');
    });

    describe('#isEnabled', function () {
      it('should be true after enable() is called', function () {
        cache.enable();
        cache.isEnabled().should.equal(true);
      });

      it('should be false after disable() is called', function () {
        cache.disable();
        cache.isEnabled().should.equal(false);
      });
    });

    describe('#enable', function () {
      it('should substitute the request functions of http and https', function () {
        cache.enable();
        require('http').request.name.should.equal('replayerRequest');
        require('https').request.name.should.equal('replayerRequest');
      });

      it('should substitute the request functions of http and https even when disable was previously called', function () {
        cache.disable();
        cache.enable();
        require('http').request.name.should.equal('replayerRequest');
        require('https').request.name.should.equal('replayerRequest');
      });
    });

    describe('#disable', function () {
      it('should reassign the original request functions of http and https', function () {
        cache.disable();
        require('http').request.name.should.equal('request');
        require('https').request.name.should.equal('request');
      });

      it('should reassign the original request functions of http and https even when enable was previously called', function () {
        cache.enable();
        cache.disable();
        require('http').request.name.should.equal('request');
        require('https').request.name.should.equal('request');
      });
    });
  });

});
