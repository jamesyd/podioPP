var jive = require("jive-sdk");
var url = require('url');
var util = require('util');
var sampleOauth = require('./routes/oauth/sampleOauth');
var q = require('q');

var metadataCollection = "basecampActivityMetadata";
var metadataStore = jive.service.persistence();

exports.getLastTimePulled = getLastTimePulled;
exports.getMetadataByInstance = getMetadataByInstance;
exports.pullActivity = pullActivity;
exports.pullComments = pullComments;
exports.updateLastTimePulled = updateLastTimePulled;
exports.recordSyncFromJive = recordSyncFromJive;

function pullActivity(extstreamInstance) {

    return getLastTimePulled(extstreamInstance, 'activity').then(function (lastTimePulled) {

        var accountID = extstreamInstance.config.accountID;
        var projectID = extstreamInstance.config.id;
        var ticketID =  extstreamInstance.config.ticketID;
        var date = new Date(lastTimePulled);
        var since = date.toISOString();   // returns Zulu time (UTC)
        var query = "/projects/" + projectID  + "/events.json?since=" + since;

        return
        return basecamp_Helpers.queryBasecampV1( accountID, ticketID, sampleOauth, query).then( function (response) {
            var entity = response['entity'] ;

            return convertToActivities(entity, lastTimePulled, extstreamInstance);

            /*
             // only return created things, not commented on or other ...
            var createdEvents  = [];
            entity.forEach(function(record) {
                  if (record.action != "commented on")
                    createdEvents.push( record );
            }  );

            return createdEvents;
            */
        }) ;
    }).catch(function (err) {
            jive.logger.error('Error querying Podio', err);
        });

};

function pullComments(extstreamInstance) {
    return getLastTimePulled(extstreamInstance, 'comment').then(function (lastTimePulled) {
        var accountID = extstreamInstance.config.accountID;
        var projectID = extstreamInstance.config.id;
        var ticketID =  extstreamInstance.config.ticketID;
        var date = new Date(lastTimePulled);
        var since = date.toISOString();   // returns Zulu time (UTC)

        var query = "/projects/" + projectID  + "/events.json?since=" + since;

        return basecamp_Helpers.queryBasecampV1( accountID, ticketID, sampleOauth, query).then( function (response) {
            var entity = response['entity'] ;

            return convertToComments(entity, lastTimePulled, extstreamInstance)  ;
            /*
            // only return created things, not commented on or other ...
            var comments  = [];
            entity.forEach(function(record) {
                if (record.action == "commented on")
                    comments.push( record );
            }  );

            return comments;
            */
        }) ;
    }).catch(function (err) {
            jive.logger.error('Error querying basecamp', err);
        });
}
function convertToActivities(entity, lastTimePulled, instance) {
    var records = entity;

    var tempActivities = records.map(function (record) {
        if (record.action != "commented on")
        {
            // need to pass the project name down ...
            // note that we should really be getting the most current project name from Basecamp, like the other tiles
            record['projectName']  = instance.config['project'];
            var json = getActivityJSON(record);

            if (!isNaN(json['podioCreatedDate'])) {
                lastTimePulled = Math.max(lastTimePulled, json['podioCreatedDate']);

            }
            return json;
        }
        else
            return null;
    });

    // now get rid of NULL entries in the array   (these will be the comments ...)
    var numActivities = tempActivities.length;
    var activities = [];
    var activityCounter=0;
    if (numActivities > 0)
    {
        for (var i=(numActivities-1); i >= 0; i--)
            if (tempActivities[i] != null)
              activities[activityCounter++] = tempActivities[i];
    }
    return updateLastTimePulled(instance, lastTimePulled, 'activity').thenResolve(activities);
}
function convertToComments(entity, lastTimePulled, instance) {
    var records = entity;
    var comments = [];
    var promise = q.resolve(null);

    records.forEach(function (record) {
        if (record['action'] == "commented on")
        {
            var podioCommentID;

            var nIdx1 = record['html_url'].lastIndexOf("_");

            if (nIdx1 > 0)
            {
                podioCommentID = record['html_url'].substring(nIdx1+1);
                // make sure we have a number and not a string to allow the sync compare to work ...
                podioCommentID = Number(podioCommentID)   ;
            }
            // need to pass the project name down ...
            // note that we should really be getting the most current project name from Basecamp, like the other tiles
            record['projectName']  = instance.config['project'];
            promise = promise.thenResolve(
                wasSynced(instance, podioCommentID).then(function (wasItSynced) {
                    if (wasItSynced) {
                        return;
                    }
                    var json = getCommentJSON(record);

                    if (!isNaN(json['podioCreatedDate'])) {
                        lastTimePulled = Math.max(lastTimePulled, json['podioCreatedDate']);
                    }
                    comments.push(json);
                }));
        }
    });

    return promise.then(function() {
        return updateLastTimePulled(instance, lastTimePulled, 'comment').thenResolve(comments);
    });
}
function getActivityJSON(record) {

    var url = record['html_url'];
    url = url.replace("basecamp.com", "www.basecamp.com") ;
    var summary =  record['summary'];
    summary = summary.replace("<span>", " ");
    summary = summary.replace("</span>", " ");

    // extract the actual Activity ID, not the event ID from the data ...
    var nIdx1 = record['html_url'].lastIndexOf("/");
    var externalID = "";
    if (nIdx1 > 0)
    {
        var nIdx2 = record['html_url'].indexOf("-", nIdx1)  ;
        if (nIdx2 > 0)
         externalID = record['html_url'].substring(nIdx1+1, nIdx2);
    }
    var createdDate = new Date(record['created_at']).getTime();
    return {

        "podioCreatedDate" : createdDate,
        "activity" : {
            "action":{
                "name":"posted",
                "description": record['projectName'] + " Activity"
            },
            "actor":{
            "name":record['creator']['name'],
                "email":""
            },
            "object":{
                "type":"website",
                    "url": url,
                    "image":"http://37signals.com/svn/images/basecamp-logo-for-fluid.png",
                    "title": summary + " @ '" + record['projectName'] + "'",
                    "description":record['excerpt']
            },
            "externalID": '' + externalID
        }
    }
};
function getCommentJSON(record) {

    var url = record['html_url'];
    url = url.replace("basecamp.com", "www.basecamp.com") ;
    var summary =  record['summary'];
    summary = summary.replace("<span>", " ");
    summary = summary.replace("</span>", " ");

    // extract the actual Activity ID, not the event ID from the data ...
    var nIdx1 = record['html_url'].lastIndexOf("_");
    var externalID = "";
    var externalActivityID = ""
    if (nIdx1 > 0)
    {
            externalID = record['html_url'].substring(nIdx1+1);
    }

    nIdx1 = record['html_url'].lastIndexOf("/");
    if (nIdx1 > 0)
    {
        var nIdx2 = record['html_url'].indexOf("-", nIdx1)  ;
        if (nIdx2 > 0)
            externalActivityID = record['html_url'].substring(nIdx1+1, nIdx2);
    }

    var createdDate = new Date(record['created_at']).getTime();
    var gName=""
    var fName=""
    var names = record['creator'] ['name'].split(" ")  ;
    var email = "";     // need to get this another way in future versions ...
    if (names.length)
    {
        gName=names[0];
        fName = names[names.length - 1] ;
    }

    return {
        "podioCreatedDate" : createdDate,
        "author" : {
            name: {
                "givenName" : gName ,
                "familyName"  : fName
            } ,
            "email" : email
        },
        "content" : {"type" : "text/html", "text" : "<p>" + record['excerpt'] +"</p>"},
        "type" : "comment",
        "externalID": '' + externalID,
        "externalActivityID" : externalActivityID
    }
    /*
    return {

        "action":{
            "name":"posted",
            "description": record['projectName'] + " Activity"
        },
        "actor":{
            "name":record['creator']['name'],
            "email":""
        },
        "object":{
            "type":"website",
            "url": url,
            "image":"http://37signals.com/svn/images/basecamp-logo-for-fluid.png",
            "title": summary + " @ '" + record['projectName'] + "'",
            "description":record['excerpt']
        },

    }
    */
};
function getMetadataByInstance(instance) {
    return metadataStore.find(metadataCollection, {'instanceID': instance['id']}).then(function (results) {
        if (results.length <= 0) {
            return null;
        }
        return results[0];
    });
}

function getLastTimePulled(instance, type) {
    return getMetadataByInstance(instance).then(function (metadata) {

        var lastTimePulled = metadata && metadata.lastTimePulled && metadata.lastTimePulled[type];

        if (!lastTimePulled) {

             // set to something way before we were born!
            lastTimePulled = new Date("2013-08-05T16:26:53.664Z").getTime();
            return updateLastTimePulled(instance, lastTimePulled, type).thenResolve(lastTimePulled);
        }
        return lastTimePulled;
    });
}

function updateLastTimePulled(instance, lastTimePulled, type) {
    return getMetadataByInstance(instance).then(function (metadata) {
        var changed = false;
        if (!metadata) {
            metadata = { "instanceID": instance['id'] };
        }
        if (!metadata.lastTimePulled) {
            metadata.lastTimePulled = {};
        }
        if (!metadata.lastTimePulled[type]) {
            metadata.lastTimePulled[type] = lastTimePulled;
            changed = true;
        }
        else {
            if (metadata.lastTimePulled[type] < lastTimePulled) {
                changed = true;
                metadata.lastTimePulled[type] = lastTimePulled;
            }
        }
        if (changed) {
            return metadataStore.save(metadataCollection, instance['id'], metadata);
        }
        return metadata;
    });
}
function recordSyncFromJive(instance, podioCommentID) {
    return getMetadataByInstance(instance).then(function (metadata) {
        if (!metadata) {
            metadata = {"instanceID": instance['id'], "syncs": []};
        }
        if (!metadata.syncs) {
            metadata.syncs = [];
        }
        var changed = false;
        if (metadata.syncs.indexOf(podioCommentID) < 0) {
            metadata.syncs.push(podioCommentID);
            changed = true;
        }
        if (changed) {
            console.log( "Jive comment sync id='" + podioCommentID + "'") ;
            return metadataStore.save(metadataCollection, instance['id'], metadata);
        }
        return metadata;
    });
}
function wasSynced(instance, podioCommentID) {
    //console.log( "Check for Jive comment sync id='" + podioCommentID+ "'" + " typeof=" + typeof podioCommentID ) ;
    return getMetadataByInstance(instance).then(function (metadata) {

        /*
        console.log( "indexOf = ", metadata.syncs.indexOf(podioCommentID)) ;
        for (var i=0; i<metadata.syncs.length; i++)
            console.log( i + " : '" + metadata.syncs[i] + "' typeof=" + typeof metadata.syncs[i]);
        */

        if (metadata && metadata.syncs && metadata.syncs.indexOf(podioCommentID) >= 0) {
            return true;
        }
        return false;

    });
}