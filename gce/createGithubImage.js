'use strict';

var fs = require('fs');
var path = require('path');
var Instance = require('sivart-GCE/Instance');
var Auth = require('sivart-GCE/Auth');
var printf = require('util').format;
var Q = require('q');
Q.longStackSupport = true;

var slaveImageName = 'github';
var instanceName = 'github-snapshot';
var zone = 'us-central1-a';
var snapshot = new Instance(Auth.projectId, zone, instanceName);

var snapshotFile = path.join(__dirname, 'github.json');
var data = JSON.parse(fs.readFileSync(snapshotFile));

var startupScript = fs.readFileSync(path.join(__dirname, 'github_snapshot.sh'), 'utf8');
data.name = instanceName;
data.disks[0].deviceName = instanceName;
//data.metadata.items[0].value = startupScript.replace('$', '\\$');
data.metadata.items[0].value = startupScript;
data.disks[0].autoDelete = false;

Q.ninvoke(snapshot, 'create', { instance: data })
  .then(function(result) {
      var deferred = Q.defer();
      function getConsole() {
        snapshot.gce.getSerialConsoleOutput({ instance: instanceName }, function(err, output) {
          if (err) {
            throw new Error(err);
          }
          var content = output.contents;
          if (content.toString().match('__DONE__')) {
            console.log(content);
            deferred.resolve();
          } else {
            console.log(content);
            setTimeout(getConsole, 10000);
          }
        });
      }
      getConsole();
      return deferred.promise;
    }).then(function(result) {
      console.log('Image created - deleting instance...');
      return Q.ninvoke(snapshot, 'delete');
    }).then(function(result) {
      return Q.ninvoke(snapshot.gce, 'start');
    })
    .then(function(compute) {
      var deferred = Q.defer();
      console.log(printf('Deleting current "%s" image...', slaveImageName));
      compute.images.delete({image: slaveImageName }, function() {
        // ignore errors
        deferred.resolve(compute);
      });
      return deferred.promise;
    })
    .then(function(compute) {
      return Q.ninvoke(compute.images, 'insert', {
        resource: {
          name: slaveImageName,
          sourceDisk: printf('zones/%s/disks/%s', zone, instanceName)
        }
      });
     })
    .then(function(imageInsertResponse) {
      console.log('Creating new image (be pateint!)...');
      return Q.ninvoke(snapshot.gce, 'waitForGlobalOperation', imageInsertResponse[0]);
    })
    .then(function() {
      return Q.ninvoke(snapshot.gce.compute.disks, 'delete', { disk: instanceName });
    })
    .then(function(deleteInsertResponse) {
      console.log('Deleting base disk (be pateint!)...');
      return Q.ninvoke(snapshot.gce, 'waitForZoneOperation', deleteInsertResponse[0]);
    }).catch(function(error) {
      console.error('error');
      console.error(error);
    }).done(function() {
      console.log(printf('All done!  New "%s" image successfully', slaveImageName));
    });
